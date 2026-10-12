const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

function runtime(stubs = {}) {
    const root = path.resolve(__dirname, '../src')
    const linker = {}
    const context = vm.createContext({ gLinker: linker, Math, console })
    const cache = new Map()
    const load = relative => {
        const filename = path.resolve(root, relative)
        const key = path.relative(root, filename)
        if (stubs[key]) return stubs[key]
        if (path.relative(root, filename) === 'engine/graph_node.js') return { GRAPH_RENDER_HAS_ANIMATION: 32 }
        if (cache.has(filename)) return cache.get(filename).exports
        const module = { exports: {} }
        cache.set(filename, module)
        const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
            filename, babelrc: false, configFile: false,
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        }).code
        vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(
            request => load(path.relative(root, path.resolve(path.dirname(filename), `${request}.js`))),
            module, module.exports)
        return module.exports
    }
    return { load, linker }
}

const closeTo = (actual, expected) => assert.ok(Math.hypot(...actual.map((value, axis) =>
    value - expected[axis])) < 1e-8, `${actual} matches ${expected}`)
const plain = value => JSON.parse(JSON.stringify(value))
const clearCollision = { find_floor: () => 0, f32_find_wall_collision: () => 0 }

test('all six tracers leave the rendered muzzle, including rotated cameras and Mario scale', () => {
    const r = runtime()
    const math = r.load('engine/math_util.js')
    const effects = r.load('game/WeaponEffects.js')
    const { mario_gun_dls } = r.load('actors/mario_gun/model.inc.js')
    for (const camera of [
        { pos: [750, 600, -1600], focus: [50, 140, 800], roll: 0.25 },
        { pos: [-650, 1200, 300], focus: [150, 200, -500], roll: -0.1 },
    ]) {
        const view = math.Mat4(), world = math.Mat4(), hand = math.Mat4()
        math.mtxf_lookat(view, camera.pos, camera.focus, camera.roll)
        math.mtxf_rotate_xyz_and_translate(world, [180, 140, 70], [-1200, 7000, 450])
        math.mtxf_scale_vec3f(world, world, [0.8, 0.8, 0.8])
        math.mtxf_mul(hand, world, view)
        for (const model of Object.values(mario_gun_dls)) {
            const muzzle = effects.gunMuzzleInWorld(hand, view, model.muzzle)
            const expected = [0, 1, 2].map(axis => world[3][axis]
                + model.muzzle[0] * world[0][axis] + model.muzzle[1] * world[1][axis])
            closeTo(muzzle.start, expected)
            closeTo(muzzle.forward, world[0].slice(0, 3).map(value => value / 0.8))
        }
    }
})

test('a hit makes world geometry and sparks which remain at the fired location as Mario moves', () => {
    const r = runtime(), api = r.load('game/WeaponEffects.js'), math = r.load('engine/math_util.js')
    const effects = api.createWeaponEffects()
    const hand = math.Mat4(), camera = math.Mat4()
    math.mtxf_identity(hand); math.mtxf_identity(camera)
    hand[3] = [100, 140, 50, 1]
    const target = { pos: [1300, 210, 50] }
    api.queueWeaponShot(effects, { range: 3500 }, [{ target }])
    assert.equal(api.weaponEffectsDisplayList(effects, [0, 600, -1000]), null, 'waits for actual muzzle')
    api.captureWeaponMuzzle(effects, hand, camera, [240, 61], clearCollision)
    closeTo(effects.shots[0].start, [340, 201, 50])
    closeTo(effects.shots[0].end, target.pos)
    assert.equal(effects.sparks.length, 3)
    const shot = plain(effects.shots[0])
    hand[3] = [-500, 200, 300, 1]
    target.pos[0] = 2000
    api.captureWeaponMuzzle(effects, hand, camera, [240, 61], clearCollision)
    assert.deepEqual(plain(effects.shots[0]), shot, 'the existing shot never follows Mario or its victim')
    const displayList = api.weaponEffectsDisplayList(effects, [0, 600, -1000])
    assert.ok(displayList.some(command => command.words.w1 && command.words.w1.vertices), 'uses rendered 3D vertices')
    for (let frame = 0; frame < 4; frame++) api.tickWeaponEffects(effects)
    assert.equal(effects.shots.length, 0)
    assert.ok(effects.sparks.length > 0, 'impacts outlive the tracer')
    for (let frame = 0; frame < 5; frame++) api.tickWeaponEffects(effects)
    assert.equal(api.weaponEffectsDisplayList(effects, [0, 600, -1000]), null)
})

test('misses visibly follow the barrel and stop against terrain rather than travelling through walls', () => {
    const r = runtime(), api = r.load('game/WeaponEffects.js'), math = r.load('engine/math_util.js')
    const hand = math.Mat4(), camera = math.Mat4()
    math.mtxf_identity(hand); math.mtxf_identity(camera)
    hand[3] = [0, 140, 0, 1]
    const effects = api.createWeaponEffects()
    api.queueWeaponShot(effects, { range: 3500 }, [])
    const wall = { find_floor: () => 0, f32_find_wall_collision: ({ x }) => x >= 700 && x <= 720 }
    api.captureWeaponMuzzle(effects, hand, camera, [240, 61], wall)
    const shot = effects.shots[0]
    assert.ok(shot.end[0] >= 700 && shot.end[0] <= 720)
    assert.equal(shot.end[1], 201)
    assert.equal(shot.end[2], 0)
    assert.equal(shot.hit, true)
    assert.equal(effects.sparks.length, 3)
    const hill = { find_floor: x => x >= 300 ? 220 : 0, f32_find_wall_collision: () => false }
    const floorHit = api.traceWeaponSurface(hill, [0, 200, 0], [1000, 200, 0])
    assert.equal(floorHit.hit, true)
    assert.equal(floorHit.end[0], 300)
})

test('shotgun pellets and sustained automatic fire stay bounded and expire', () => {
    const r = runtime(), api = r.load('game/WeaponEffects.js'), math = r.load('engine/math_util.js')
    const effects = api.createWeaponEffects(), hand = math.Mat4(), camera = math.Mat4()
    math.mtxf_identity(hand); math.mtxf_identity(camera)
    hand[3] = [0, 140, 0, 1]
    const hits = [{ target: { pos: [1300, 200, 0] } }]
    api.queueWeaponShot(effects, { range: 2000, pellets: 6 }, hits)
    api.captureWeaponMuzzle(effects, hand, camera, [392, 60], clearCollision)
    assert.equal(effects.shots.length, 6)
    assert.ok(new Set(effects.shots.map(shot => shot.end.join(','))).size > 1, 'pellets fan out')
    for (const shot of effects.shots) closeTo(shot.start, [392, 200, 0])
    for (let frame = 0; frame < 90; frame++) {
        api.queueWeaponShot(effects, { range: 4500 }, hits)
        api.captureWeaponMuzzle(effects, hand, camera, [392, 64], clearCollision)
        assert.ok(effects.shots.length <= 24 && effects.sparks.length <= 72)
        api.tickWeaponEffects(effects)
    }
    for (let frame = 0; frame < 9; frame++) api.tickWeaponEffects(effects)
    assert.equal(effects.shots.length + effects.sparks.length, 0)
})

function defeatedObject(constants, extra = {}) {
    const rawData = Array(0x50).fill(0)
    rawData[constants.oPosZ] = 500
    rawData[constants.oInteractType] = 1 << 17
    return { rawData, activeFlags: 1, weaponDefeated: true, weaponHealth: 0,
        gfx: { flags: 0xFFFF, scale: [2, 2, 2], pos: [0, 0, 500], angle: [0, 0, 0] }, ...extra }
}

test('resistant enemies fall away from the shooter, stop fighting and remain dead until cleanup', () => {
    const r = runtime(), constants = r.load('include/object_constants.js')
    const api = r.load('game/WeaponDefeat.js'), enemy = defeatedObject(constants)
    api.beginWeaponDefeat(enemy, [0, 100, 0], true)
    assert.equal(enemy.rawData[constants.oInteractType], 0, 'no longer damages or grabs Mario')
    assert.equal(enemy.rawData[constants.oIntangibleTimer], -1)
    for (let frame = 0; frame < 12; frame++) assert.equal(api.updateWeaponDefeat(enemy, clearCollision), true)
    assert.equal(enemy.rawData[constants.oFaceAnglePitch], -0x4000, 'fallen on its back')
    assert.ok(enemy.rawData[constants.oPosZ] > 500, 'the shot knocks it away from Mario')
    for (let frame = 12; frame < 105; frame++) api.updateWeaponDefeat(enemy, clearCollision)
    assert.equal(enemy.activeFlags, 1, 'corpse is still visible')
    assert.equal(enemy.rawData[constants.oPosY], 0, 'rests on the floor')
    assert.equal(enemy.weaponHealth, 0)
    for (let frame = 105; frame < 120; frame++) api.updateWeaponDefeat(enemy, clearCollision)
    assert.equal(enemy.activeFlags, constants.ACTIVE_FLAG_DEACTIVATED)
    assert.deepEqual(plain(enemy.gfx.scale), [0, 0, 0])
    assert.equal(enemy.weaponDefeated, true)
})

test('native deaths and Bob-omb explosions retain their behavior; survivors have a knockout fallback', () => {
    const r = runtime(), constants = r.load('include/object_constants.js'), api = r.load('game/WeaponDefeat.js')
    const native = defeatedObject(constants)
    api.beginWeaponDefeat(native, [0, 100, 0])
    for (let frame = 0; frame < 29; frame++) assert.equal(api.updateWeaponDefeat(native, clearCollision), false)
    assert.equal(native.weaponKnockout, undefined, 'native kicked animation owns these frames')
    assert.equal(api.updateWeaponDefeat(native, clearCollision), true, 'resistant survivors cannot resume combat')
    const bomb = defeatedObject(constants, { weaponExplodes: true })
    for (let frame = 0; frame < 150; frame++) assert.equal(api.updateWeaponDefeat(bomb, clearCollision), false)
    assert.equal(bomb.weaponKnockout, undefined)
})

test('an enemy shot above the ground keeps falling until its corpse reaches the floor', () => {
    const r = runtime(), constants = r.load('include/object_constants.js'), api = r.load('game/WeaponDefeat.js')
    const enemy = defeatedObject(constants)
    enemy.rawData[constants.oPosY] = 1800
    api.beginWeaponDefeat(enemy, [0, 1600, 0], true)
    for (let frame = 0; frame < 70; frame++) api.updateWeaponDefeat(enemy, clearCollision)
    assert.equal(enemy.rawData[constants.oPosY], 0)
    assert.equal(enemy.activeFlags, 1)
    assert.equal(enemy.weaponHealth, 0)
})

test('Bully knockout finishes through native cleanup to preserve its minion counters and rewards', () => {
    const r = runtime(), constants = r.load('include/object_constants.js'), api = r.load('game/WeaponDefeat.js')
    const bully = defeatedObject(constants, { weaponBully: true })
    api.beginWeaponDefeat(bully, [0, 100, 0], true)
    bully.rawData[constants.oInteractStatus] = 1 << 15
    for (let frame = 0; frame < 119; frame++) assert.equal(api.updateWeaponDefeat(bully, clearCollision), true)
    assert.equal(api.updateWeaponDefeat(bully, clearCollision), false)
    assert.equal(bully.rawData[constants.oAction], constants.BULLY_ACT_LAVA_DEATH)
    assert.equal(bully.rawData[constants.oPrevAction], constants.BULLY_ACT_LAVA_DEATH, 'timer survives behavior update')
    assert.equal(bully.rawData[constants.oTimer], 31, 'native cleanup can finish without a lava floor')
    assert.equal(bully.rawData[constants.oInteractStatus], 0, 'a finishing kick cannot interrupt native cleanup')
})

test('the native Bully loop still awards minion coins and performs big Bully level cleanup after gun kills', () => {
    const coins = [], bridges = []
    const r = runtime({
        'audio/external.js': {},
        'utils.js': { random_float: () => 0.5 },
        'game/BehaviorData.js': {},
        'game/Camera.js': {},
        'game/Interaction.js': { INTERACT_BULLY: 1 << 17, INT_STATUS_INTERACTED: 1 << 15 },
        'game/ObjBehaviors.js': { set_object_visibility: () => {}, obj_lava_death: () => {
            const object = r.linker.ObjectListProcessor.gCurrentObject
            assert.equal(object.rawData[constants.oTimer], 31)
            object.activeFlags = 0
            return true
        } },
        'game/ObjectHelpers.js': {
            spawn_mist_particles: () => {},
            spawn_object: () => { const coin = { rawData: [] }; coins.push(coin); return coin },
            spawn_object_abs_with_rot: (...args) => bridges.push(args),
        },
        'game/SpawnSound.js': { cur_obj_play_sound_2: () => {} },
    })
    const constants = r.load('include/object_constants.js'), api = r.load('game/WeaponDefeat.js')
    const native = r.load('game/behaviors/bully.inc.js')
    const small = defeatedObject(constants, { weaponBully: true, parentObj: { rawData: Array(0x50).fill(0) } })
    small.rawData[constants.oBehParams2ndByte] = constants.BULLY_BP_SIZE_SMALL
    small.rawData[constants.oBullySubtype] = constants.BULLY_STYPE_MINION
    const big = defeatedObject(constants, { weaponBully: true })
    big.rawData[constants.oBehParams2ndByte] = constants.BULLY_BP_SIZE_BIG
    for (const object of [small, big]) {
        api.beginWeaponDefeat(object, [0, 100, 0], true)
        for (let frame = 0; frame < 120; frame++) api.updateWeaponDefeat(object, clearCollision)
        r.linker.ObjectListProcessor = { gCurrentObject: object }
        r.linker.behaviors = { bhvLLLTumblingBridge: [] }
        native.bhv_bully_loop()
        assert.equal(object.activeFlags, 0)
    }
    assert.equal(small.parentObj.rawData[constants.oBullyKBTimerAndMinionKOCounter], 1)
    assert.equal(coins.length, 1)
    assert.equal(coins[0].rawData[constants.oVelY], 100)
    assert.equal(bridges.length, 1)
})

test('a defeated Luigi stops companion AI immediately and cannot become a ghost passenger', () => {
    const car = { driving: false, x: 0, y: 0, z: 0, yaw: 0 }
    const r = runtime({
        'game/GardenCar.js': { getGardenCar: () => car },
        'actors/mario/marioAnimData.js': { gMarioAnimData: Array.from({ length: 0xD0 }, (_, id) =>
            ({ id, flags: 0, unk08: 20, unk04: 0, unk02: 0 })) },
    })
    const constants = r.load('include/object_constants.js'), death = r.load('game/WeaponDefeat.js')
    const companion = r.load('game/LuigiCompanion.js')
    const luigi = defeatedObject(constants, { weaponDefeated: false, weaponHealth: 100 })
    luigi.gfx.animInfo = {}
    r.linker.Area = { gCurrentArea: {} }
    r.linker.ObjectListProcessor = { gCurrentObject: luigi }
    r.linker.LevelUpdate = { gMarioState: { pos: [0, 0, 700], marioObj: {}, action: 1 } }
    companion.bhv_luigi_companion_loop()
    assert.equal(companion.getLuigiCompanion(), luigi)
    luigi.weaponDefeated = true
    luigi.weaponHealth = 0
    death.beginWeaponDefeat(luigi, [0, 100, 0], true)
    assert.equal(death.updateWeaponDefeat(luigi, clearCollision), true, 'the behavior hook owns the lethal frame')
    assert.equal(companion.getLuigiCompanion(), null, 'passenger dialogue sees no living Luigi')
    const position = plain(luigi.rawData.slice(constants.oPosX, constants.oPosZ + 1))
    const state = plain(luigi.luigi)
    car.driving = true
    r.linker.LevelUpdate.gMarioState.pos = [20000, 0, 20000]
    companion.bhv_luigi_companion_loop()
    assert.deepEqual(plain(luigi.rawData.slice(constants.oPosX, constants.oPosZ + 1)), position)
    assert.deepEqual(plain(luigi.luigi), state, 'neither catch-up warps nor car boarding revive Luigi')
    for (let frame = 1; frame < 120; frame++) death.updateWeaponDefeat(luigi, clearCollision)
    assert.equal(luigi.activeFlags, 0)
    companion.bhv_luigi_companion_loop()
    assert.equal(companion.getLuigiCompanion(), null)
    assert.equal(luigi.weaponHealth, 0)
})

test('the Luigi getter excludes inactive and stale-area objects; a fresh level instance can return', () => {
    const r = runtime({
        'game/GardenCar.js': { getGardenCar: () => null },
        'actors/mario/marioAnimData.js': { gMarioAnimData: Array.from({ length: 0xD0 }, (_, id) =>
            ({ id, flags: 0, unk08: 20, unk04: 0, unk02: 0 })) },
    })
    const constants = r.load('include/object_constants.js'), companion = r.load('game/LuigiCompanion.js')
    const oldLuigi = defeatedObject(constants, { weaponDefeated: false, weaponHealth: 100 })
    oldLuigi.gfx.animInfo = {}
    r.linker.Area = { gCurrentArea: {} }
    r.linker.ObjectListProcessor = { gCurrentObject: oldLuigi }
    r.linker.LevelUpdate = { gMarioState: { pos: [0, 0, 700], marioObj: {}, action: 1 } }
    companion.bhv_luigi_companion_loop()
    oldLuigi.activeFlags = 0
    assert.equal(companion.getLuigiCompanion(), null)
    oldLuigi.activeFlags = 1
    r.linker.Area.gCurrentArea = {}
    assert.equal(companion.getLuigiCompanion(), null)
    oldLuigi.weaponDefeated = true
    const freshLuigi = defeatedObject(constants, { weaponDefeated: false, weaponHealth: 100 })
    freshLuigi.gfx.animInfo = {}
    r.linker.ObjectListProcessor.gCurrentObject = freshLuigi
    companion.bhv_luigi_companion_loop()
    assert.equal(companion.getLuigiCompanion(), freshLuigi)
    assert.equal(oldLuigi.weaponDefeated, true)
})
