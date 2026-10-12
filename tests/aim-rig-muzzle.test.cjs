const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// Exercise the game solvers and renderer's matrix math without WebGL.
function runtime() {
    const root = path.resolve(__dirname, '../src')
    const context = vm.createContext({ gLinker: {}, console, Math })
    const cache = new Map()
    function load(relative) {
        const filename = path.resolve(root, relative)
        if (cache.has(filename)) return cache.get(filename).exports
        const module = { exports: {} }
        cache.set(filename, module)
        const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
            filename, babelrc: false, configFile: false,
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        }).code
        const fn = vm.runInContext(`(function(require,module,exports){${code}\n})`, context)
        fn(request => load(path.relative(root, path.resolve(path.dirname(filename), request + (path.extname(request) === '.js' ? '' : '.js')))), module, module.exports)
        return module.exports
    }
    return { load }
}

const transformPoint = (matrix, point) => [0, 1, 2].map(axis => matrix[3][axis]
    + point.reduce((sum, value, row) => sum + value * matrix[row][axis], 0))
const subtract = (a, b) => a.map((value, axis) => value - b[axis])
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0)
const normalized = vector => vector.map(value => value / Math.hypot(...vector))

function armMatrices(M, shoulder, rotations, torso) {
    let matrix = torso
    return [shoulder, [0, 0, 0], [65, 0, 0], [60, 0, 0]].map((position, part) => {
        const local = M.Mat4(), world = M.Mat4()
        M.mtxf_rotate_xyz_and_translate(local, position, rotations[part])
        M.mtxf_mul(world, local, matrix)
        return matrix = world
    })
}

function torsoMatrix(M, position, angle, scale) {
    const rotation = M.Mat4(), torso = M.Mat4()
    M.mtxf_rotate_zxy_and_translate(rotation, position, angle)
    M.mtxf_scale_vec3f(torso, rotation, [scale, scale, scale])
    return torso
}

function assertBarrelOnTarget(hand, muzzle, target, label) {
    const origin = transformPoint(hand, [muzzle[0], muzzle[1], 0])
    const direction = normalized(hand[0].slice(0, 3))
    const delta = subtract(target, origin), along = dot(delta, direction)
    const miss = Math.hypot(...delta.map((value, axis) => value - along * direction[axis]))
    // Three moving joints round XYZ rotations to SM64's 16-bit angle units.
    const tolerance = 0.03 + Math.hypot(...delta) * 4 * Math.PI / 0x8000
    assert.ok(along > 0, `${label}: target is ahead of the muzzle`)
    assert.ok(miss <= tolerance, `${label}: barrel misses by ${miss.toFixed(3)} (tolerance ${tolerance.toFixed(3)})`)
}

test('all gun muzzle centre lines meet the target after quantized arm rotations', () => {
    const r = runtime(), M = r.load('engine/math_util.js')
    const rig = r.load('game/MarioAimRig.js')
    const { WEAPONS } = r.load('game/Weapons.js')
    const { mario_gun_dls: models } = r.load('actors/mario_gun/model.inc.js')
    const targets = [[260, 2200, -240], [-350, 1400, 500], [900, 650, -50],
        [200, 750, 25], [1000, 400, 800], [1268, -10, -79]]
    const scenes = [
        [[0, 0, 0], [0, 0, 0], 0.25],
        [[760, 430, -250], [-1900, -32000, 4200], 0.1875],
        [[150, -40, 800], [23000, -12000, 1600], 0.325],
    ]
    for (const gun of WEAPONS) for (const point of targets) {
        const muzzle = models[gun.id].muzzle
        const aim = { point, dir: [0, 1, 0], up: [1, 0, 0], muzzleHeight: muzzle[1] }
        const solved = gun.foregrip ? rig.solveTwoHanded(aim, gun.foregrip)
            : { right: rig.solveGunArm(aim).rotations, left: null }
        for (const [position, angle, scale] of scenes) {
            const torso = torsoMatrix(M, position, angle, scale)
            const right = armMatrices(M, rig.SHOULDER_R, solved.right, torso)
            const label = `${gun.id} target ${point} pose ${angle}`
            assertBarrelOnTarget(right[3], muzzle, transformPoint(torso, point), label)
            // Forward kinematics still preserves the upper-arm and forearm lengths.
            assert.ok(Math.abs(Math.hypot(...subtract(right[2][3], right[0][3])) - 65 * scale) < 1e-8, label)
            assert.ok(Math.abs(Math.hypot(...subtract(right[3][3], right[2][3])) - 60 * scale) < 1e-8, label)
            if (solved.left) {
                const left = armMatrices(M, rig.SHOULDER_L, solved.left, torso)[3]
                const offset = subtract(left[3].slice(0, 3), right[3][3].slice(0, 3)).map(value => value / scale)
                const forward = normalized(right[3][0].slice(0, 3)), up = normalized(right[3][1].slice(0, 3))
                const grip = dot(offset, forward), height = dot(offset, up)
                const side = Math.hypot(...offset.map((value, axis) => value - grip * forward[axis] - height * up[axis]))
                assert.ok(grip >= 29.9 && grip <= gun.foregrip[0] + 0.1, `${label}: left hand reaches the foregrip`)
                assert.ok(Math.abs(height - gun.foregrip[1]) < 0.1 && side < 0.1, `${label}: left hand stays on the barrel`)
            }
        }
    }
})

test('two-handed muzzle correction keeps the support hand on each forward-facing gun', () => {
    const r = runtime(), M = r.load('engine/math_util.js')
    const rig = r.load('game/MarioAimRig.js')
    const { WEAPONS } = r.load('game/Weapons.js')
    const { mario_gun_dls: models } = r.load('actors/mario_gun/model.inc.js')
    for (const gun of WEAPONS.filter(weapon => weapon.foregrip)) {
        const aim = { point: [200, 1500, -100], dir: [0, 1, 0], up: [1, 0, 0], muzzleHeight: models[gun.id].muzzle[1] }
        const solved = rig.solveTwoHanded(aim, gun.foregrip)
        assert.ok(solved.left, `${gun.id}: support hand remains engaged`)
        const torso = torsoMatrix(M, [0, 0, 0], [0, 0, 0], 1)
        assertBarrelOnTarget(armMatrices(M, rig.SHOULDER_R, solved.right, torso)[3], models[gun.id].muzzle, aim.point, gun.id)
    }
})

test('muzzle compensation preserves free aim and defaults to zero offset', () => {
    const r = runtime(), rig = r.load('game/MarioAimRig.js')
    for (const dir of [[0, 1, 0], [0.3, -0.7, 0.4], [1, 0, 0]]) {
        const aim = { point: null, dir, up: [1, 0, 0] }
        assert.deepEqual(rig.solveGunArm({ ...aim, muzzleHeight: 70 }), rig.solveGunArm(aim))
        assert.deepEqual(rig.solveTwoHanded({ ...aim, muzzleHeight: 70 }, [200, 40]), rig.solveTwoHanded(aim, [200, 40]))
    }
    const aim = { point: [200, 1500, -100], dir: [0, 1, 0], up: [1, 0, 0] }
    assert.deepEqual(rig.solveGunArm(aim), rig.solveGunArm({ ...aim, muzzleHeight: 0 }))
    assert.deepEqual(rig.solveTwoHanded(aim, [200, 40]), rig.solveTwoHanded({ ...aim, muzzleHeight: 0 }, [200, 40]))
})

test('coincident and close targets produce finite arm rotations', () => {
    const r = runtime(), rig = r.load('game/MarioAimRig.js')
    for (const point of [rig.SHOULDER_R, [68, 114, -79], [68, 115, -79], [68, -9, -79]]) {
        const aim = { point, dir: [0, 1, 0], up: [1, 0, 0], muzzleHeight: 70 }
        assert.ok(rig.solveGunArm(aim).rotations.flat().every(Number.isFinite))
        const solved = rig.solveTwoHanded(aim, [200, 40])
        assert.ok(solved.right.flat().every(Number.isFinite))
        assert.ok(!solved.left || solved.left.flat().every(Number.isFinite))
    }
})
