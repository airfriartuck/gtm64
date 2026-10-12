const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

const load = () => {
    const filename = path.resolve(__dirname, '../src/game/CarEnterExit.js')
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code
    const module = { exports: {} }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, vm.createContext({ Math }))(() => ({}), module, module.exports)
    return module.exports
}
const flat = () => 260
const body = (moveSpeed, turnSpeed = [0, 0, 0]) => ({ moveSpeed, turnSpeed, right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] })
const car = extra => ({ x: 0, y: 260, z: 0, yaw: 0, pitch: 0, roll: 0, ...extra })

test('exit follows CVehicle::CanPedStepOutCar / CanPedJumpOutCar', () => {
    const { exitMode } = load()
    assert.equal(exitMode(car()), 'step')
    assert.equal(exitMode(car({ body: body([0.005, 0, 0.005]) })), 'step', 'about 1 km/h: step out')
    assert.equal(exitMode(car({ body: body([0, 0, 0.1]) })), 'wait', '18 km/h: too fast to step, too slow to jump')
    assert.equal(exitMode(car({ body: body([0, 0, 0.4]) })), 'jump', '72 km/h: roll out')
    assert.equal(exitMode(car({ body: body([0, 0, 0.8]) })), 'wait', '144 km/h: too fast even to jump')
    assert.equal(exitMode(car({ body: body([0, 0, 0], [0, 0.05, 0]) })), 'wait', 'spinning in place')
})

test('entering walks to the driver door, lines up, vaults over the door and sits facing forward', () => {
    const { beginEnter, stepSequence, carPoint, DRIVER_DOOR, DRIVER_SEAT, SEATED_SCALE, ANIM } = load()
    const parked = car({ yaw: 16384 })
    const seq = beginEnter([500, 260, -300], 0)
    const door = carPoint(parked, DRIVER_DOOR), seat = carPoint(parked, DRIVER_SEAT)
    const poses = []
    for (let i = 0; i < 200; i++) {
        const pose = stepSequence(seq, parked, flat)
        poses.push({ phase: seq.phase, ...pose })
        if (pose.done) break
    }
    const walking = poses.filter(p => p.anim.id === ANIM.WALKING)
    assert.ok(walking.length > 5, 'walks over')
    assert.ok(walking.every((p, i) => i === 0 || Math.hypot(p.pos[0] - walking[i - 1].pos[0], p.pos[2] - walking[i - 1].pos[2]) <= 14.01))
    const atDoor = poses.find(p => p.anim.id === ANIM.IDLE)
    assert.ok(Math.hypot(atDoor.pos[0] - door[0], atDoor.pos[2] - door[2]) < 1, 'stands at the driver door')
    const last = poses[poses.length - 1]
    assert.ok(last.done)
    assert.ok(Math.hypot(...last.pos.map((v, i) => v - seat[i])) < 1, 'ends in the driver seat')
    assert.ok(Math.abs(((last.angle[1] - parked.yaw) % 65536 + 65536) % 65536) < 2 || Math.abs(((last.angle[1] - parked.yaw) % 65536 + 65536) % 65536 - 65536) < 2, 'faces forward')
    assert.equal(last.scale, SEATED_SCALE)
    assert.ok(Math.max(...poses.map(p => p.pos[1])) > 260 + 70, 'clears the door')
    assert.ok(poses.some(p => p.anim.id === ANIM.SIT_DOWN), 'sits down at the end')
})

test('climbing out lands at the exit facing away from the car; rolling out leans out of the driver side', () => {
    const { beginExit, stepSequence, ANIM } = load()
    const parked = car()
    const exit = beginExit('step', [220, 260, 0])
    let pose
    for (let i = 0; i < 40 && !(pose && pose.done); i++) pose = stepSequence(exit, parked, flat)
    assert.ok(pose.done)
    assert.deepEqual([...pose.pos.map(Math.round)], [220, 260, 0])
    assert.equal(Math.round(pose.angle[1]), 0x4000, 'faces out of the driver door')
    assert.equal(pose.anim.id, ANIM.LAND)
    assert.equal(pose.scale, 1)
    const jump = beginExit('jump')
    for (let i = 0; i < 40 && !(pose && pose.done && jump.frame > 1); i++) pose = stepSequence(jump, parked, flat)
    assert.equal(jump.kind, 'jump')
    assert.ok(pose.pos[0] > 60, 'leans out over the driver door')
    assert.equal(pose.anim.id, ANIM.DIVE)
})

test('from the passenger side Mario walks round the end of the car, never through it', () => {
    const { beginEnter, stepSequence, carPoint, DRIVER_DOOR } = load()
    for (const start of [[-300, 260, 40], [-200, 260, -250], [-90, 260, 500], [0, 260, -600]]) {
        const parked = car()
        const seq = beginEnter(start, 0)
        let reached = false
        for (let i = 0; i < 300 && !reached; i++) {
            const pose = stepSequence(seq, parked, flat)
            if (seq.phase === 'approach') {
                // The car's footprint: 85 wide each side, 215 front and back.
                const [x, , z] = pose.pos
                assert.ok(!(Math.abs(x) < 85 && Math.abs(z) < 215), `walked through the car at ${pose.pos.map(Math.round)}`)
            }
            reached = seq.phase !== 'approach'
        }
        assert.ok(reached, `reached the door from ${start}`)
        const door = carPoint(parked, DRIVER_DOOR)
        assert.ok(Math.hypot(seq.pos[0] - door[0], seq.pos[2] - door[2]) < 1)
    }
})
