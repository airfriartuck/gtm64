import * as Keydrown from "./keydrown.min.js"

/////// Keyboard / Gamepad Input ////////
window.playerInput = {}

//// Prevent scrolling for arrow keys
window.addEventListener("keydown", (e) => {

    // space and arrow keys
    if ([32, 37, 38, 39, 40].indexOf(e.keyCode) > -1) {
        e.preventDefault()
    }
}, false)

const keyboardButtons = {}

if (navigator.getGamepads) navigator.getGamepads()

const allKeyboardButtons = [
    'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'z', 'x', 'c', 'v', 'b', 'n', 'm',
    'backspace', 'tab', 'space', 'shift', 'enter', 'up', 'down', 'left', 'right', 'ctrl'
]

Keydrown.Q.down(() => { keyboardButtons.q = true })
Keydrown.W.down(() => { keyboardButtons.w = true })
Keydrown.E.down(() => { keyboardButtons.e = true })
Keydrown.R.down(() => { keyboardButtons.r = true })
Keydrown.T.down(() => { keyboardButtons.t = true })
Keydrown.Y.down(() => { keyboardButtons.y = true })
Keydrown.U.down(() => { keyboardButtons.u = true })
Keydrown.I.down(() => { keyboardButtons.i = true })
Keydrown.O.down(() => { keyboardButtons.o = true })
Keydrown.P.down(() => { keyboardButtons.p = true })

Keydrown.A.down(() => { keyboardButtons.a = true })
Keydrown.S.down(() => { keyboardButtons.s = true })
Keydrown.D.down(() => { keyboardButtons.d = true })
Keydrown.F.down(() => { keyboardButtons.f = true })
Keydrown.G.down(() => { keyboardButtons.g = true })
Keydrown.H.down(() => { keyboardButtons.h = true })
Keydrown.J.down(() => { keyboardButtons.j = true })
Keydrown.K.down(() => { keyboardButtons.k = true })
Keydrown.L.down(() => { keyboardButtons.l = true })

Keydrown.Z.down(() => { keyboardButtons.z = true })
Keydrown.X.down(() => { keyboardButtons.x = true })
Keydrown.C.down(() => { keyboardButtons.c = true })
Keydrown.V.down(() => { keyboardButtons.v = true })
Keydrown.B.down(() => { keyboardButtons.b = true })
Keydrown.N.down(() => { keyboardButtons.n = true })
Keydrown.M.down(() => { keyboardButtons.m = true })

Keydrown.BACKSPACE.down(() => { keyboardButtons.backspace = true })
Keydrown.TAB.down(() => { keyboardButtons.tab = true })
Keydrown.SHIFT.down(() => { keyboardButtons.shift = true })
Keydrown.SPACE.down(() => { keyboardButtons.space = true })
Keydrown.ENTER.down(() => { keyboardButtons.enter = true })
Keydrown.UP.down(() => { keyboardButtons.up = true })
Keydrown.DOWN.down(() => { keyboardButtons.down = true })
Keydrown.LEFT.down(() => { keyboardButtons.left = true })
Keydrown.RIGHT.down(() => { keyboardButtons.right = true })
Keydrown.CTRL.down(() => { keyboardButtons.ctrl = true })

Keydrown.ESC.down(() => { window.fullWindowMode = false })

///////////

Keydrown.Q.up(() => { keyboardButtons.q = false })
Keydrown.W.up(() => { keyboardButtons.w = false })
Keydrown.E.up(() => { keyboardButtons.e = false })
Keydrown.R.up(() => { keyboardButtons.r = false })
Keydrown.T.up(() => { keyboardButtons.t = false })
Keydrown.Y.up(() => { keyboardButtons.y = false })
Keydrown.U.up(() => { keyboardButtons.u = false })
Keydrown.I.up(() => { keyboardButtons.i = false })
Keydrown.O.up(() => { keyboardButtons.o = false })
Keydrown.P.up(() => { keyboardButtons.p = false })

Keydrown.A.up(() => { keyboardButtons.a = false })
Keydrown.S.up(() => { keyboardButtons.s = false })
Keydrown.D.up(() => { keyboardButtons.d = false })
Keydrown.F.up(() => { keyboardButtons.f = false })
Keydrown.G.up(() => { keyboardButtons.g = false })
Keydrown.H.up(() => { keyboardButtons.h = false })
Keydrown.J.up(() => { keyboardButtons.j = false })
Keydrown.K.up(() => { keyboardButtons.k = false })
Keydrown.L.up(() => { keyboardButtons.l = false })

Keydrown.Z.up(() => { keyboardButtons.z = false })
Keydrown.X.up(() => { keyboardButtons.x = false })
Keydrown.C.up(() => { keyboardButtons.c = false })
Keydrown.V.up(() => { keyboardButtons.v = false })
Keydrown.B.up(() => { keyboardButtons.b = false })
Keydrown.N.up(() => { keyboardButtons.n = false })
Keydrown.M.up(() => { keyboardButtons.m = false })

Keydrown.BACKSPACE.up(() => { keyboardButtons.backspace = false })
Keydrown.TAB.up(() => { keyboardButtons.tab = false })
Keydrown.SHIFT.up(() => { keyboardButtons.shift = false })
Keydrown.SPACE.up(() => { keyboardButtons.space = false })
Keydrown.ENTER.up(() => { keyboardButtons.enter = false })
Keydrown.UP.up(() => { keyboardButtons.up = false })
Keydrown.DOWN.up(() => { keyboardButtons.down = false })
Keydrown.LEFT.up(() => { keyboardButtons.left = false })
Keydrown.RIGHT.up(() => { keyboardButtons.right = false })
Keydrown.CTRL.up(() => { keyboardButtons.ctrl = false })

const keyboardButtonMapping = {
    a: 'space',
    b: 'b',
    start: 'enter',
    z: 'z',
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    cu: 'i',
    cd: 'k',
    cl: 'j',
    cr: 'l',
    rt: 'o'
}
const defaultKeyboardButtonMapping = { ...keyboardButtonMapping }

// Defaults follow a Nintendo Switch Pro Controller in the browser's standard
// layout, where buttons are numbered by position (0 bottom, 1 right, 2 left,
// 3 top), and match Super Mario 3D All-Stars: A jumps, B attacks, ZL crouches
// (N64 Z), R changes the camera, + is Start and the right stick is the C buttons.
// ZR aims a gun and L switches guns.
const gamepadButtonMapping = {
    a: 1,          // A
    b: 0,          // B
    start: 9,      // +
    z: 6,          // ZL
    stickX: 0,
    stickY: 1,
    cStickX: 2,
    cStickY: 3,
    rt: 5,         // R
    aim: 7,        // ZR
    nextWeapon: 4, // L
}

const defaultGamepadButtonMapping = { ...gamepadButtonMapping }

let deadzone = 0.3
const cameraDeadzone = 0.2

if (localStorage['controls']) {
    Object.assign(keyboardButtonMapping, JSON.parse(localStorage['controls']).keyboard)
    Object.assign(gamepadButtonMapping, JSON.parse(localStorage['controls']).gamepad)
}

/// Fillout the select options - Keyboard only - gamepad does this on gamepad connect
Array.from(document.getElementsByTagName("select")).forEach(selectElem => {
    if (selectElem.hasAttribute("keyboardButton")) {
        allKeyboardButtons.forEach(key => {
            const option = document.createElement("option")
            option.value = key
            option.text = key
            selectElem.add(option)
        })
    }

    if (selectElem.hasAttribute("keyboardButton")) {
        selectElem.value = keyboardButtonMapping[selectElem.name]
    }
})

const keyboardControlsHtml = $('#keyboardControlsWindow').detach()
const gamepadControlsHtml = $('#gamepadControlsWindow').detach()

$('[data-toggle="keyboardControlsToggle"]').popover({
    container: "body",
    content: keyboardControlsHtml
})

$('[data-toggle="gamepadControlsToggle"]').popover({
    container: "body",
    content: gamepadControlsHtml
})

let gamepadIndex

window.addEventListener("gamepadconnected", function (e) {

    const gamepad = e.gamepad

    gamepadIndex = gamepad.index

    const numButtons = gamepad.buttons.length
    const numAxes = gamepad.axes.length

    $('[data-toggle="gamepadControlsToggle"]').popover('show')

    document.getElementById('noGamepadMessage').hidden = true
    document.getElementById('gamepadMessageDiv').hidden = false
    document.getElementById('gamepadMessage').innerHTML = `Detected Gamepad: "${gamepad.id.slice(0, 30)}" with ${numButtons} Buttons`

    ///Fillout the select options and set default value
    const controlsWindowDiv = document.getElementById('gamepadControlsWindow')
    controlsWindowDiv.querySelectorAll("select").forEach(selectElem => {
        if (selectElem.options.length == 0) { /// insert options
            if (selectElem.hasAttribute("gamepadButton")) {
                for (let i = 0; i < numButtons; i++) {
                    const option = document.createElement("option")
                    option.value = i
                    option.text = i
                    selectElem.add(option)
                }
            }
            if (selectElem.hasAttribute("gamepadAxes")) {
                for (let i = 0; i < numAxes; i++) {
                    const option = document.createElement("option")
                    option.value = i
                    option.text = i
                    selectElem.add(option)
                }
            }
        }
        selectElem.value = gamepadButtonMapping[selectElem.name]
    })

    $('[data-toggle="gamepadControlsToggle"]').popover('hide')

})

window.updateDeadZone = (data) => { deadzone = data }

window.updateKeyboardMapping = (chosenKey, gameButton) => {
    keyboardButtonMapping[gameButton] = chosenKey
}

window.updateGamepadMapping = (chosenKey, gameButton) => {
    gamepadButtonMapping[gameButton] = parseInt(chosenKey)
}

window.saveControls = () => {
    localStorage['controls'] = JSON.stringify({
        keyboard: keyboardButtonMapping,
        gamepad: gamepadButtonMapping
    })
}

window.loadDefaultControls = () => {
    Object.assign(keyboardButtonMapping, defaultKeyboardButtonMapping)
    Object.assign(gamepadButtonMapping, defaultGamepadButtonMapping)
    /// set default values
    Array.from(document.getElementsByTagName("select")).forEach(selectElem => {
        if (selectElem.hasAttribute("keyboardButton")) {
            selectElem.value = keyboardButtonMapping[selectElem.name]
        }
        if (selectElem.hasAttribute("gamepadButton")) {
            selectElem.value = gamepadButtonMapping[selectElem.name]
        }
        if (selectElem.hasAttribute("gamepadAxes")) {
            selectElem.value = gamepadButtonMapping[selectElem.name]
        }
    })
}

const applyDeadzone = (number, threshold) => {
    let percentage = (Math.abs(number) - threshold) / (1 - threshold)

    if (percentage < 0) percentage = 0

    return percentage * (number > 0 ? 1 : -1)
}

export const playerInputUpdate = () => {

    Keydrown.tick()

    const keyboardFinal = {}, gamepadFinal = {}

    Object.entries(keyboardButtonMapping).forEach(([key, value]) => {
        keyboardFinal[key] = Boolean(keyboardButtons[value])
    })

    let stickX = 0, stickY = 0, cameraStickX = 0, cameraStickY = 0, gamepad
    if (navigator.getGamepads) {
        gamepad = navigator.getGamepads()[gamepadIndex]
    }
    // Missing buttons (smaller pads) read as released rather than throwing.
    const padButton = name => {
        const button = gamepad && gamepad.buttons[gamepadButtonMapping[name]]
        return Boolean(button && (button.pressed || button.touched))
    }
    if (gamepad) {
        stickX = gamepad.axes[gamepadButtonMapping['stickX']]
        stickY = gamepad.axes[gamepadButtonMapping['stickY']] * -1

        // hack to help wonky sticks out
        stickX *= 1.05
        if (stickX < -1.0) {
            stickX = -1.0
        } else if (stickX > 1.0) {
            stickX = 1.0
        }

        stickY *= 1.05
        if (stickY < -1.0) {
            stickY = -1.0
        } else if (stickY > 1.0) {
            stickY = 1.0
        }
        const cStickX = gamepad.axes[gamepadButtonMapping['cStickX']]
        const cStickY = gamepad.axes[gamepadButtonMapping['cStickY']]
        // The right stick also turns the camera freely (up is positive).
        cameraStickX = applyDeadzone(cStickX || 0, cameraDeadzone)
        cameraStickY = -applyDeadzone(cStickY || 0, cameraDeadzone)
        Object.assign(gamepadFinal, {
            a: padButton('a'),
            b: padButton('b'),
            start: padButton('start'),
            z: padButton('z'),
            cr: cStickX > 0.5,
            cl: cStickX < -0.5,
            cu: cStickY < -0.5,
            cd: cStickY > 0.5,
            rt: padButton('rt'),
            aim: padButton('aim'),
            nextWeapon: padButton('nextWeapon'),
        })
    }

    stickX = applyDeadzone(stickX, deadzone)
    stickY = applyDeadzone(stickY, deadzone)

    if (stickX == 0 && stickY == 0) {
        if (keyboardFinal.right) stickX += 1
        if (keyboardFinal.left) stickX -= 1

        if (keyboardFinal.up) stickY += 1
        if (keyboardFinal.down) stickY -= 1
    }

    stickX = Math.round(stickX * 64)
    stickY = Math.round(stickY * 64)

    let mag = Math.sqrt((stickX * stickX) + (stickY * stickY))

    let buttonDownA = gamepadFinal.a || keyboardFinal.a
    let buttonDownB = gamepadFinal.b || keyboardFinal.b
    let buttonDownStart = gamepadFinal.start || keyboardFinal.start
    let buttonDownZ = gamepadFinal.z || keyboardFinal.z
    let buttonDownCl = gamepadFinal.cl || keyboardFinal.cl
    let buttonDownCr = gamepadFinal.cr || keyboardFinal.cr
    let buttonDownCu = gamepadFinal.cu || keyboardFinal.cu
    let buttonDownCd = gamepadFinal.cd || keyboardFinal.cd
    let buttonDownRt = gamepadFinal.rt || keyboardFinal.rt

    // On the keyboard, weapons use fixed keys like the car: Q aims and R
    // switches guns. Gamepad buttons come from the mapping above.
    const buttonDownAim = Boolean(keyboardButtons.q) || Boolean(gamepadFinal.aim)
    const buttonDownNextWeapon = Boolean(keyboardButtons.r) || Boolean(gamepadFinal.nextWeapon)

    window.playerInput = {
        buttonDownAim,
        buttonDownNextWeapon,
        buttonPressedNextWeapon: buttonDownNextWeapon && !window.playerInput.buttonDownNextWeapon,
        buttonPressedVehicle: Boolean(keyboardButtons.e) && !window.playerInput.buttonDownVehicle,
        buttonDownVehicle: Boolean(keyboardButtons.e),
        stickX, stickY,
        stickMag: mag,
        cameraStickX, cameraStickY,

        buttonPressedA: buttonDownA && !window.playerInput.buttonDownA,
        buttonPressedStart: buttonDownStart && !window.playerInput.buttonDownStart,
        buttonPressedB: buttonDownB && !window.playerInput.buttonDownB,
        buttonPressedZ: buttonDownZ && !window.playerInput.buttonDownZ,
        buttonPressedCl: buttonDownCl && !window.playerInput.buttonDownCl,
        buttonPressedCr: buttonDownCr && !window.playerInput.buttonDownCr,
        buttonPressedCu: buttonDownCu && !window.playerInput.buttonDownCu,
        buttonPressedCd: buttonDownCd && !window.playerInput.buttonDownCd,
        buttonPressedRt: buttonDownRt && !window.playerInput.buttonDownRt,

        buttonDownA, buttonDownB, buttonDownZ, buttonDownStart, buttonDownCl, buttonDownCr, buttonDownCu, buttonDownCd, buttonDownRt
    }

}
