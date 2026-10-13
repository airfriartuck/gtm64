const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// Load the real input manager with the DOM, jQuery and Keydrown stubbed, and a
// fake gamepad in the browser's standard layout.
function inputManager(savedControls) {
    const root = path.resolve(__dirname, '../src')
    const listeners = {}
    const pad = { index: 0, id: 'Pro Controller', buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false })),
        axes: [0, 0, 0, 0] }
    const element = () => ({ hidden: false, innerHTML: '', querySelectorAll: () => [] })
    const jquery = () => ({ detach: () => ({}), popover() {} })
    const context = vm.createContext({
        console, Math, Boolean, JSON, parseInt,
        window: { addEventListener: (name, fn) => { listeners[name] = fn } },
        document: { getElementsByTagName: () => [], getElementById: element, createElement: element },
        navigator: { getGamepads: () => [pad] },
        localStorage: savedControls ? { controls: JSON.stringify(savedControls) } : {},
        $: jquery,
    })
    context.window.playerInput = {}
    const keydrown = new Proxy({ tick() {} }, { get: (target, key) => target[key] || { down() {}, up() {} } })
    const filename = path.join(root, 'player_input_manager.js')
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code
    const module = { exports: {} }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(() => keydrown, module, module.exports)
    listeners.gamepadconnected({ gamepad: pad })
    const read = (...pressed) => {
        pad.buttons.forEach((button, i) => { button.pressed = button.touched = pressed.includes(i) })
        module.exports.playerInputUpdate()
        return context.window.playerInput
    }
    return { read, pad }
}

test('default gamepad controls follow a Switch Pro Controller', () => {
    const { read, pad } = inputManager()
    assert.equal(read().buttonDownA, false)
    assert.equal(read(1).buttonDownA, true, 'A (right face) jumps')
    assert.equal(read(0).buttonDownB, true, 'B (bottom face) attacks / fires')
    assert.equal(read(6).buttonDownZ, true, 'ZL crouches')
    assert.equal(read(9).buttonDownStart, true, '+ is Start')
    assert.equal(read(5).buttonDownRt, true, 'R changes the camera')
    assert.equal(read(7).buttonDownAim, true, 'ZR aims')
    read()
    assert.equal(read(4).buttonPressedNextWeapon, true, 'L switches guns')
    assert.equal(read(4).buttonPressedNextWeapon, false, 'once per press')
    // Y and X aren't bound, so they do nothing.
    const idle = read(2, 3)
    assert.ok(!idle.buttonDownA && !idle.buttonDownB && !idle.buttonDownAim)

    pad.axes = [0.9, -0.9, 0.9, -0.9]
    const sticks = read()
    assert.ok(sticks.stickX > 50 && sticks.stickY > 50, 'left stick moves (up is positive)')
    assert.equal(sticks.buttonDownCr, true, 'right stick right is C-right')
    assert.equal(sticks.buttonDownCu, true, 'right stick up is C-up')
})

test('saved controls still win, and missing buttons read as released', () => {
    const { read, pad } = inputManager({ keyboard: {}, gamepad: { a: 3, aim: 30 } })
    assert.equal(read(3).buttonDownA, true)
    assert.equal(read(1).buttonDownA, false)
    pad.buttons.length = 10
    assert.equal(read().buttonDownAim, false)
})

test('the right stick reports analog camera input with a small deadzone', () => {
    const { read, pad } = inputManager()
    pad.axes = [0, 0, 0.1, -0.1]
    let input = read()
    assert.equal(input.cameraStickX, 0, 'resting drift is ignored')
    assert.equal(input.cameraStickY, 0)
    pad.axes = [0, 0, 0.6, -1]
    input = read()
    assert.ok(input.cameraStickX > 0.4 && input.cameraStickX < 0.6, 'partial tilt turns the camera partway')
    assert.equal(input.cameraStickY, 1, 'up is positive')
    assert.ok(input.stickX == 0 && input.stickY == 0, 'the left stick is unaffected')
})
