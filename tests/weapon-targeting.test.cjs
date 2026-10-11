const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// Load game ES modules in a VM with selected imports stubbed (same approach as
// garden-car.test.cjs) so the weapon code runs without the browser or WebGL.
function runtime(stubs = {}) {
    const root = path.resolve(__dirname, '../src')
    const linker = {}
    const context = vm.createContext({ gLinker: linker, window: { playerInput: {} }, console, Math })
    const cache = new Map()
    function load(relative) {
        const filename = path.resolve(root, relative)
        const key = path.relative(root, filename)
        if (stubs[key]) return stubs[key]
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
    return { load, linker, context }
}

const targeting = () => runtime().load('game/WeaponTargeting.js')
const pistol = { range: 3500 }
const shooter = { pos: [0, 100, 0] }
const enemy = (x, z, extra = {}) => ({ pos: [x, 100, z], visible: true, ...extra })
const clear = () => false
const flat = {
    find_floor: () => 0,
    f32_find_wall_collision: () => 0,
}

test('lock-on prefers enemies in front of the camera and weighs distance by its fourth root', () => {
    const t = targeting()
    const ahead = enemy(0, 1500), behind = enemy(0, -300)
    assert.equal(t.findLockOnTarget(shooter, [behind, ahead], pistol, 0, clear), ahead)
    // A target more than 140° off the aim direction is never chosen.
    assert.equal(t.findLockOnTarget(shooter, [behind], pistol, 0, clear), null)
    // GTA's falloff: a near enemy 30° to the side beats a far one dead ahead.
    const near = enemy(Math.sin(Math.PI / 6) * 300, Math.cos(Math.PI / 6) * 300)
    const far = enemy(0, 3400)
    assert.equal(t.findLockOnTarget(shooter, [far, near], pistol, 0, clear), near)
    // ...but a flagged priority target (bThisPedIsATargetPriority) wins outright.
    far.priority = 1
    assert.equal(t.findLockOnTarget(shooter, [far, near], pistol, 0, clear), far)
})

test('targets out of range, invisible, unreachable or behind walls are skipped', () => {
    const t = targeting()
    assert.equal(t.findLockOnTarget(shooter, [enemy(0, 3600)], pistol, 0, clear), null)
    assert.equal(t.findLockOnTarget(shooter, [enemy(0, 500, { visible: false })], pistol, 0, clear), null)
    // Straight overhead is beyond the arm's reach (GTA: CanIKReachThisTarget).
    const overhead = { pos: [0, 900, 100], visible: true }
    assert.equal(t.targetHasToBeBroken(shooter, overhead, pistol), true)
    const hidden = enemy(0, 500), visible = enemy(400, 1200)
    assert.equal(t.findLockOnTarget(shooter, [hidden, visible], pistol, 0, (s, target) => target === hidden), visible)
})

test('next-target switching steps to the nearest enemy on the requested side', () => {
    const t = targeting()
    const current = enemy(0, 1000)
    // Facing +Z, +X is Mario's left.
    const left1 = enemy(300, 1000), left2 = enemy(900, 900), right1 = enemy(-500, 1000)
    const all = [current, left1, left2, right1]
    assert.equal(t.findNextLockOnTarget(shooter, current, all, pistol, true, clear), left1)
    assert.equal(t.findNextLockOnTarget(shooter, current, all, pistol, false, clear), right1)
    assert.equal(t.findNextLockOnTarget(shooter, right1, [right1, current], pistol, false, clear), null)
    assert.ok(t.angleOffAim([0, 0, 0], [100, 0, 100], 0) > 0, 'left is a positive angle')
})

test('line of sight is blocked by walls and terrain rising above the line', () => {
    const t = targeting()
    const from = [0, 100, 0], to = [0, 100, 1000]
    assert.equal(t.lineOfSightBlocked(flat, from, to), false)
    // A paper-thin wall at z = 500 is only found by a probe within its 10-unit radius.
    const wall = { ...flat, f32_find_wall_collision: (pos, offset, radius) => Math.abs(pos.z - 500) <= radius ? 1 : 0 }
    assert.equal(t.lineOfSightBlocked(wall, from, to), true)
    const hill = { ...flat, find_floor: (x, y, z) => z > 400 && z < 600 ? 150 : 0 }
    assert.equal(t.lineOfSightBlocked(hill, from, to), true)
    // A bridge far overhead doesn't block a shot underneath it.
    const bridge = { ...flat, find_floor: (x, y, z) => z > 400 && z < 600 && y + 100 >= 600 ? 600 : 0 }
    assert.equal(t.lineOfSightBlocked(bridge, from, to), false)
})

test('marker projection matches the camera and colours by health', () => {
    const t = targeting()
    const camera = { pos: [0, 0, -1000], focus: [0, 0, 0], fov: 45 }
    const centre = t.projectToScreen(camera, [0, 0, 0], 640, 480)
    assert.deepEqual([Math.round(centre.x), Math.round(centre.y)], [320, 240])
    // Looking down +Z, -X is screen-right and +Y is screen-up.
    assert.ok(t.projectToScreen(camera, [-100, 0, 0], 640, 480).x > 320)
    assert.ok(t.projectToScreen(camera, [0, 100, 0], 640, 480).y < 240)
    // The top edge of a 45° view is at tan(22.5°) × depth.
    const edge = t.projectToScreen(camera, [0, Math.tan(Math.PI / 8) * 1000, 0], 640, 480)
    assert.ok(Math.abs(edge.y) < 1e-6)
    assert.equal(t.projectToScreen(camera, [0, 0, -2000], 640, 480), null)
    assert.deepEqual([...t.markerColour(1)], [0, 255, 0])
    assert.deepEqual([...t.markerColour(0)], [255, 0, 0])
    assert.deepEqual([...t.markerColour(0.5)], [128, 128, 0])
})

// MarioWeapon glue with the Mario/Interaction/geo modules replaced by their constants.
const ACT_GUN_AIM = 0x0000023F, ACT_IDLE = 0x0C400201, ACT_WALKING = 0x04000440
const ACT_BUTT_SLIDE = 0x00840452, ACT_JUMP = 0x03000880
function weaponRuntime() {
    const r = runtime({
        'game/Mario.js': { ACT_GUN_AIM, ACT_GROUP_MASK: 0x1C0, ACT_GROUP_STATIONARY: 0, ACT_GROUP_MOVING: 0x40,
            ACT_FLAG_ALLOW_FIRST_PERSON: 1 << 26, ACT_FLAG_INVULNERABLE: 1 << 17, ACT_FLAG_SHORT_HITBOX: 1 << 15,
            ACT_FLAG_RIDING_SHELL: 1 << 16, ACT_FLAG_DIVING: 1 << 19, ACT_FLAG_BUTT_OR_STOMACH_SLIDE: 1 << 18,
            INPUT_OFF_FLOOR: 4 },
        'game/Interaction.js': { INTERACT_BOUNCE_TOP: 1 << 15, INTERACT_BOUNCE_TOP2: 1 << 20,
            INTERACT_HIT_FROM_BELOW: 1 << 22, INTERACT_KOOPA: 1 << 7, INTERACT_BULLY: 1 << 17, INTERACT_MR_BLIZZARD: 1 << 21 },
        'engine/graph_node.js': { GRAPH_RENDER_ACTIVE: 1, GRAPH_RENDER_INVISIBLE: 16 },
        'engine/GeoLayout.js': { LAYER_OPAQUE: 1 },
        'actors/mario_gun/model.inc.js': { mario_pistol_dl: ['pistol'] },
    })
    const lists = Array.from({ length: 13 }, () => { const head = {}; head.next = head; return head })
    const add = (index, object) => {
        object.next = lists[index].next
        lists[index].next = object
        return object
    }
    const object = (x, z, type, extra = {}) => {
        const rawData = []
        rawData[0x06] = x; rawData[0x07] = 0; rawData[0x08] = z
        rawData[0x2A] = type; rawData[0x3F] = extra.health || 0
        return { rawData, activeFlags: 1, gfx: { flags: 1 }, hitboxHeight: 100, hitboxDownOffset: 0, ...extra }
    }
    const mario = { pos: [0, 0, 0], action: ACT_IDLE, input: 0 }
    Object.assign(r.linker, {
        ObjectListProcessor: { gObjectLists: lists },
        LevelUpdate: { gMarioState: mario },
        Camera: { gLakituState: { pos: [0, 200, -800], focus: [0, 100, 0] }, sFOVState: { fov: 45 } },
        SurfaceCollision: flat,
        behaviors: { bhvBobomb: ['bobomb'] },
    })
    return { weapon: r.load('game/MarioWeapon.js'), lists, add, object, mario, r }
}

test('only active, attackable enemies are collected as targets', () => {
    const { weapon, lists, add, object, r } = weaponRuntime()
    const goomba = add(5, object(0, 500, 1 << 15))
    add(5, object(0, 600, 1 << 4))                          // coin
    add(4, object(0, 700, 1 << 15, { activeFlags: 0 }))     // unloaded
    const koopa = add(4, object(100, 700, 1 << 7))
    const bully = add(4, object(200, 700, 1 << 17, { gfx: { flags: 17 } }))
    const bobomb = add(2, object(300, 700, 1 << 1, { behavior: r.linker.behaviors.bhvBobomb }))
    add(2, object(400, 700, 1 << 1, { behavior: ['crate'] }))   // other grabbables stay friendly
    const targets = weapon.collectEnemies(lists)
    assert.deepEqual([...targets.map(t => t.object)].sort((a, b) => a.rawData[6] - b.rawData[6]), [goomba, koopa, bully, bobomb])
    assert.equal(targets.find(t => t.object === bully).visible, false)
    assert.deepEqual([...targets.find(t => t.object === goomba).pos], [0, 50, 500])
})

test('aiming starts from standing or walking only, with the aim button held', () => {
    const { weapon, mario } = weaponRuntime()
    const held = { buttonDownAim: true }
    assert.equal(weapon.canStartAiming(mario, {}), false)
    assert.equal(weapon.canStartAiming(mario, held), true)
    mario.action = ACT_WALKING
    assert.equal(weapon.canStartAiming(mario, held), true)
    for (const action of [ACT_GUN_AIM, ACT_BUTT_SLIDE, ACT_JUMP]) {
        mario.action = action
        assert.equal(weapon.canStartAiming(mario, held), false)
    }
    mario.action = ACT_IDLE
    mario.heldObj = {}
    assert.equal(weapon.canStartAiming(mario, held), false)
})

test('the lock holds, switches with C-left / C-right, and the gun only shows while aiming', () => {
    const { weapon, add, object, mario } = weaponRuntime()
    const centre = add(5, object(0, 1000, 1 << 15, { health: 4 }))
    const left = add(5, object(400, 1000, 1 << 15))
    mario.action = ACT_GUN_AIM
    const node = { flags: 0 }
    assert.equal(weapon.geo_mario_gun(1, node)[0], 'pistol')
    assert.equal(node.flags >> 8, 1)

    const input = {}
    const yaw = weapon.updateWeaponAim(mario, input)
    assert.equal(weapon.weaponState.target.object, centre)
    assert.ok(Math.abs(yaw) < 1)
    centre.rawData[0x3F] = 1
    weapon.updateWeaponAim(mario, input)
    assert.equal(weapon.weaponState.target.object, centre, 'the lock is kept while valid')
    assert.equal(weapon.weaponState.target.health, 0.25)

    const press = { buttonPressedCl: true }
    const leftYaw = weapon.updateWeaponAim(mario, press)
    assert.equal(weapon.weaponState.target.object, left)
    assert.ok(leftYaw > 0)
    assert.equal(press.buttonPressedCl, false, 'the camera must not also turn')
    weapon.updateWeaponAim(mario, { buttonPressedCr: true })
    assert.equal(weapon.weaponState.target.object, centre)

    // The lock breaks when the target dies and moves to the next enemy.
    centre.activeFlags = 0
    weapon.updateWeaponAim(mario, {})
    assert.equal(weapon.weaponState.target.object, left)

    mario.action = ACT_IDLE
    assert.equal(weapon.geo_mario_gun(1, node), null)
})
