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
const ACT_BUTT_SLIDE = 0x00840452, ACT_JUMP = 0x03000880, ACT_DOUBLE_JUMP = 0x03000881, ACT_FREEFALL = 0x0100088C
const ACT_LONG_JUMP = 0x03000888, ACT_WALL_KICK_AIR = 0x03000886, ACT_BACKFLIP = 0x01000883, ACT_GROUND_POUND = 0x008008A9
const ACT_JUMP_LAND = 0x04000470, ACT_BACKWARD_AIR_KB = 0x010208B0, INPUT_B_PRESSED = 0x2000
const ACT_TRIPLE_JUMP = 0x01000882, ACT_SPECIAL_TRIPLE_JUMP = 0x030008AF, ACT_SIDE_FLIP = 0x01000887, ACT_DIVE = 0x0188088A
const ACT_TOP_OF_POLE_JUMP = 0x0300088D, ACT_STEEP_JUMP = 0x03000885, ACT_JUMP_LAND_STOP = 0x0C000230
const LANDINGS = { ACT_JUMP_LAND, ACT_FREEFALL_LAND: 0x04000471, ACT_DOUBLE_JUMP_LAND: 0x04000472, ACT_SIDE_FLIP_LAND: 0x04000473,
    ACT_TRIPLE_JUMP_LAND: 0x04000478, ACT_BACKFLIP_LAND: 0x0400047A, ACT_LONG_JUMP_LAND: 0x00000479 }
function weaponRuntime() {
    const r = runtime({
        'game/Mario.js': { ACT_GUN_AIM, ACT_GROUP_MASK: 0x1C0, ACT_GROUP_STATIONARY: 0, ACT_GROUP_MOVING: 0x40,
            ACT_FLAG_ALLOW_FIRST_PERSON: 1 << 26, ACT_FLAG_INVULNERABLE: 1 << 17, ACT_FLAG_SHORT_HITBOX: 1 << 15,
            ACT_FLAG_RIDING_SHELL: 1 << 16, ACT_FLAG_DIVING: 1 << 19, ACT_FLAG_BUTT_OR_STOMACH_SLIDE: 1 << 18,
            INPUT_OFF_FLOOR: 4, INPUT_B_PRESSED, ACT_JUMP, ACT_DOUBLE_JUMP, ACT_FREEFALL, ACT_LONG_JUMP,
            ACT_WALL_KICK_AIR, ACT_TRIPLE_JUMP, ACT_SPECIAL_TRIPLE_JUMP, ACT_BACKFLIP, ACT_SIDE_FLIP,
            ACT_TOP_OF_POLE_JUMP, ACT_STEEP_JUMP, ...LANDINGS },
        'game/Interaction.js': { INTERACT_BOUNCE_TOP: 1 << 15, INTERACT_BOUNCE_TOP2: 1 << 20,
            INTERACT_HIT_FROM_BELOW: 1 << 22, INTERACT_KOOPA: 1 << 7, INTERACT_BULLY: 1 << 17, INTERACT_MR_BLIZZARD: 1 << 21,
            ATTACK_KICK_OR_TRIP: 2, INT_STATUS_INTERACTED: 1 << 15, INT_STATUS_WAS_ATTACKED: 1 << 14 },
        'engine/graph_node.js': { GRAPH_RENDER_ACTIVE: 1, GRAPH_RENDER_INVISIBLE: 16, GEO_CONTEXT_RENDER: 1 },
        'engine/GeoLayout.js': { LAYER_OPAQUE: 1 },
        'actors/mario_gun/model.inc.js': { mario_gun_dls: new Proxy({}, { get: (t, id) => ({
            dl: [id], flashDl: [id, 'flash'], muzzle: [240, 61],
        }) }) },
        'audio/external.js': { play_gun_sound: (sound) => sounds.push(sound) },
    })
    const sounds = []
    const lists = Array.from({ length: 13 }, () => { const head = {}; head.next = head; return head })
    const add = (index, object) => {
        object.next = lists[index].next
        lists[index].next = object
        return object
    }
    const object = (x, z, type, extra = {}) => {
        const rawData = []
        rawData[0x06] = x; rawData[0x07] = 0; rawData[0x08] = z
        rawData[0x2A] = type
        return { rawData, activeFlags: 1, gfx: { flags: 1 }, hitboxHeight: 100, hitboxDownOffset: 0, ...extra }
    }
    const mario = { pos: [0, 0, 0], action: ACT_IDLE, input: 0, faceAngle: [0, 0, 0], marioObj: { gfx: {} } }
    Object.assign(r.linker, {
        ObjectListProcessor: { gObjectLists: lists },
        LevelUpdate: { gMarioState: mario },
        Camera: { gLakituState: { pos: [0, 200, -800], focus: [0, 100, 0] }, sFOVState: { fov: 45 } },
        SurfaceCollision: flat,
        behaviors: { bhvBobomb: ['bobomb'] },
    })
    return { weapon: r.load('game/MarioWeapon.js'), lists, add, object, mario, r, sounds }
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
    const centre = add(5, object(0, 1000, 1 << 15))
    const left = add(5, object(400, 1000, 1 << 15))
    mario.action = ACT_GUN_AIM
    const node = { flags: 0 }
    assert.equal(weapon.geo_mario_gun(1, node)[0], 'pistol')
    assert.equal(node.flags >> 8, 1)

    const input = {}
    const yaw = weapon.updateWeaponAim(mario, input)
    assert.equal(weapon.weaponState.target.object, centre)
    assert.ok(Math.abs(yaw) < 1)
    weapon.updateWeaponAim(mario, input)
    assert.equal(weapon.weaponState.target.object, centre, 'the lock is kept while valid')
    assert.equal(weapon.weaponState.target.health, 1)

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

const weapons = () => runtime().load('game/Weapons.js')

test('six distinct GTA weapon types, each with a gun model and muzzle flash', () => {
    const { WEAPONS, nextWeapon } = weapons()
    assert.deepEqual([...WEAPONS.map(w => w.type)], ['WEAPON_PISTOL', 'WEAPON_DESERT_EAGLE', 'WEAPON_SHOTGUN',
        'WEAPON_MICRO_UZI', 'WEAPON_M4', 'WEAPON_SNIPERRIFLE'])
    // Every enum name really exists in gta-reversed's eWeaponType, when it's checked out next door.
    const enumFile = path.resolve(__dirname, '../../gta-reversed/source/game_sa/Enums/eWeaponType.h')
    if (fs.existsSync(enumFile)) {
        const source = fs.readFileSync(enumFile, 'utf8')
        for (const weapon of WEAPONS) assert.match(source, new RegExp(`\\b${weapon.type}\\b`))
    }
    const r = runtime()
    const { mario_gun_dls } = r.load('actors/mario_gun/model.inc.js')
    for (const weapon of WEAPONS) {
        const model = mario_gun_dls[weapon.id]
        assert.ok(model && model.dl.length > 10, `${weapon.id} has a model`)
        assert.ok(model.flashDl.length > model.dl.length, `${weapon.id} has a muzzle flash`)
        assert.ok(model.muzzle.length === 2 && model.muzzle.every(Number.isFinite), `${weapon.id} exposes its muzzle position`)
    }
    assert.equal(new Set(WEAPONS.map(w => JSON.stringify(mario_gun_dls[w.id].dl))).size, WEAPONS.length, 'models differ')
    assert.equal(nextWeapon(0), 1)
    assert.equal(nextWeapon(WEAPONS.length - 1), 0)
    // Sniper outranges everything; the shotgun is short-range and multi-pellet.
    const byId = Object.fromEntries(WEAPONS.map(w => [w.id, w]))
    assert.ok(WEAPONS.every(w => w === byId.sniper || w.range < byId.sniper.range))
    assert.ok(byId.shotgun.range < byId.pistol.range && byId.shotgun.pellets > 1)
})

test('the trigger respects semi-auto presses, fire rate, clip size and reload', () => {
    const { WEAPONS, newAmmo, pullTrigger } = weapons()
    const pistol = WEAPONS[0], smg = WEAPONS.find(w => w.id === 'smg')
    const ammo = newAmmo()
    assert.equal(pullTrigger(ammo[0], pistol, true, true), true)
    // Holding the trigger doesn't refire a semi-automatic, even after the cooldown.
    for (let i = 0; i < 30; i++) assert.equal(pullTrigger(ammo[0], pistol, false, true), false)
    assert.equal(pullTrigger(ammo[0], pistol, true, true), true)
    assert.equal(ammo[0].clip, pistol.clip - 2)

    // An automatic fires every `interval` frames while held, until the clip runs dry.
    const smgAmmo = ammo[WEAPONS.indexOf(smg)]
    let shots = 0, frames = 0
    while (smgAmmo.reload === 0) { frames++; if (pullTrigger(smgAmmo, smg, false, true)) shots++ }
    assert.equal(shots, smg.clip)
    assert.equal(frames, (smg.clip - 1) * smg.interval + 1)
    // Reloading blocks the trigger, then refills the clip.
    for (let i = 0; i < smg.reload - 1; i++) assert.equal(pullTrigger(smgAmmo, smg, true, true), false)
    assert.equal(pullTrigger(smgAmmo, smg, true, true), true)
    assert.equal(smgAmmo.clip, smg.clip - 1)
})

test('shots hit the lock, else the nearest enemy in the spread; shotgun pellets hit a crowd', () => {
    const { WEAPONS, shotHits } = weapons()
    const [pistol] = WEAPONS, shotgun = WEAPONS.find(w => w.id === 'shotgun')
    const nearAhead = enemy(20, 600), farAhead = enemy(0, 1500), aside = enemy(800, 600)
    const all = [farAhead, aside, nearAhead]
    assert.deepEqual([...shotHits(shooter, 0, aside, all, pistol, clear).map(h => h.target)], [aside])
    const free = shotHits(shooter, 0, null, all, pistol, clear)
    assert.equal(free.length, 1)
    assert.equal(free[0].target, nearAhead)
    assert.equal(free[0].damage, pistol.damage)
    assert.equal(shotHits(shooter, 0x8000, null, all, pistol, clear).length, 0, 'nothing behind Mario is hit')
    assert.equal(shotHits(shooter, 0, null, [nearAhead], pistol, () => true).length, 0, 'walls stop bullets')

    const close = enemy(-60, 300), mid = enemy(60, 1200), out = enemy(0, 2500)
    const blast = shotHits(shooter, 0, null, [close, mid, out, aside], shotgun, clear)
    assert.deepEqual([...blast.map(h => h.target)], [close, mid])
    assert.ok(blast[0].damage > blast[1].damage, 'pellets spread out with distance')
    assert.ok(blast[0].damage >= 75)
})

test('enemies take GTA damage until defeated; Bob-ombs explode and heavies last longer', () => {
    const { weapon, lists, add, object, r } = weaponRuntime()
    const goomba = add(5, object(0, 500, 1 << 15))
    const bobomb = add(2, object(100, 500, 1 << 1, { behavior: r.linker.behaviors.bhvBobomb }))
    const bully = add(4, object(-100, 500, 1 << 17))
    for (let i = 0; i < 3; i++) assert.equal(weapon.damageEnemy(goomba, 25), false)
    assert.equal(goomba.rawData[0x2B], undefined, 'no SM64 attack until health runs out')
    assert.equal(weapon.damageEnemy(goomba, 25), true)
    assert.equal(goomba.rawData[0x2B], 2 | (1 << 15) | (1 << 14), 'defeated by a kick-style attack')
    assert.equal(weapon.damageEnemy(goomba, 25), false, 'only defeated once')
    weapon.damageEnemy(bobomb, 100)
    assert.equal(bobomb.rawData[0x31], 3, 'BOBOMB_ACT_EXPLODE')
    assert.equal(weapon.damageEnemy(bully, 125), false)
    assert.equal(weapon.damageEnemy(bully, 125), true)
    assert.equal(weapon.collectEnemies(lists).length, 0, 'defeated enemies are no longer targets')
    // The Goomba and Bob-omb despawn; the Bully survives its knockback and returns.
    goomba.activeFlags = bobomb.activeFlags = 0
    for (let i = 0; i < 88; i++) assert.equal(weapon.collectEnemies(lists).length, 0)
    const back = weapon.collectEnemies(lists)
    assert.equal(back.length, 1)
    assert.equal(back[0].object, bully)
    assert.equal(back[0].health, 1)
})

test('B fires at the lock, tints the marker, and the lock moves on after a kill', () => {
    const { weapon, add, object, mario, sounds } = weaponRuntime()
    const first = add(5, object(0, 1000, 1 << 15))
    const second = add(5, object(300, 1000, 1 << 15))
    mario.action = ACT_GUN_AIM
    weapon.updateWeaponAim(mario, {})
    assert.equal(weapon.weaponState.target.object, first)
    weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    assert.equal(sounds.length, 1)
    assert.equal(first.weaponHealth, 75)
    assert.equal(weapon.weaponState.target.health, 0.75)
    assert.equal(weapon.geo_mario_gun(1, { flags: 0 })[1], 'flash', 'muzzle flash on the shot')
    weapon.updateWeaponAim(mario, {})
    weapon.updateWeaponAim(mario, {})
    assert.equal(weapon.geo_mario_gun(1, { flags: 0 }).length, 1, 'flash fades')
    for (let i = 0; i < 3; i++) {
        for (let wait = 0; wait < 8; wait++) weapon.updateWeaponAim(mario, {})
        weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    }
    assert.equal(first.weaponDefeated, true)
    assert.equal(weapon.weaponState.target, null)
    weapon.updateWeaponAim(mario, {})
    assert.equal(weapon.weaponState.target.object, second)
    assert.equal(weapon.weaponState.ammo[0].clip, 13)
})

test('shotgun spread follows the current aim while Mario is still turning toward the lock', () => {
    const { weapon, add, object, mario } = weaponRuntime()
    const lock = add(5, object(1000, 900, 1 << 15))
    const besideLock = add(5, object(1050, 1050, 1 << 15))
    const oldFacing = add(5, object(0, 900, 1 << 15))
    mario.action = ACT_GUN_AIM
    mario.faceAngle[1] = 0
    weapon.weaponState.index = 2
    weapon.weaponState.target = { object: lock }

    const aimYaw = weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    assert.ok(aimYaw > 0x2000, 'the selected enemy is well outside the previous body heading')
    assert.ok(lock.weaponHealth < 100)
    assert.ok(besideLock.weaponHealth < 100, 'pellets follow the selected target direction')
    assert.equal(oldFacing.weaponHealth, 100, 'enemies along the old body heading are outside the blast')
})

test('R cycles weapons, each with its own clip, and the hand shows the selected gun', () => {
    const { weapon, mario } = weaponRuntime()
    mario.action = ACT_GUN_AIM
    const seen = []
    for (let i = 0; i < 6; i++) {
        seen.push(weapon.geo_mario_gun(1, { flags: 0 })[0])
        weapon.updateWeaponHud({ buttonPressedNextWeapon: true })
    }
    assert.deepEqual(seen, ['pistol', 'deagle', 'shotgun', 'smg', 'm4', 'sniper'])
    assert.equal(weapon.currentWeapon().id, 'pistol', 'wraps around')
    assert.ok(weapon.weaponState.hudFrames > 0, 'the panel shows the new gun')
    weapon.weaponState.index = 3
    weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    assert.equal(weapon.weaponState.ammo[3].clip, 49)
    assert.equal(weapon.weaponState.ammo[0].clip, 17)
})

test('strafing animations walk the legs while the upper body holds the aiming pose', () => {
    const r = runtime()
    const { pinParts, strafeDirection, AIM_PARTS } = r.load('game/MarioAimAnimation.js')
    const { gMarioAnimData } = r.load('actors/mario/marioAnimData.js')
    const walk = gMarioAnimData[0x48], punch = gMarioAnimData[0x67]
    // 3 root translation channels + 20 parts × 3 rotations, as the composite assumes.
    for (const anim of [walk, punch, gMarioAnimData[0x7F], gMarioAnimData[0x80]]) {
        assert.equal(anim.indices.filter(v => v !== null).length / 2, 63)
    }
    const aim = pinParts(walk, punch, 10)
    const value = (anim, part, axis, frame) => {
        const i = (3 + part * 3 + axis) * 2
        return anim.values[anim.indices[i + 1] + Math.min(frame, anim.indices[i] - 1)]
    }
    assert.equal(aim.unk08, walk.unk08, 'keeps the walk cycle length')
    assert.equal(aim.flags, walk.flags)
    for (const frame of [0, 20, 60]) {
        for (const part of AIM_PARTS) for (let axis = 0; axis < 3; axis++) {
            // Frame 10 is past the 5-frame punch, so it holds the punch's last (fully extended) value.
            assert.equal(value(aim, part, axis, frame), value(punch, part, axis, 4), `part ${part} pinned`)
        }
        for (const part of [12, 13, 14, 17, 18]) for (let axis = 0; axis < 3; axis++) {
            assert.equal(value(aim, part, axis, frame), value(walk, part, axis, frame), `leg part ${part} walks`)
        }
        // The root translation still bobs with the walk.
        assert.equal(aim.values[aim.indices[3] + Math.min(frame, aim.indices[2] - 1)],
            walk.values[walk.indices[3] + Math.min(frame, walk.indices[2] - 1)])
    }
    assert.notEqual(walk.indices, aim.indices, 'the original animation is untouched')
    assert.equal(pinParts(walk, punch, 10, AIM_PARTS, { reverse: true }).flags & 2, 2, 'backwards plays reversed')

    assert.equal(strafeDirection(0, 0), 'forward')
    assert.equal(strafeDirection(0x8000, 0), 'backward')
    assert.equal(strafeDirection(0x4000, 0), 'left')
    assert.equal(strafeDirection(-0x4000, 0), 'right')
    assert.equal(strafeDirection(0x4000 - 100, -0x8000 + 0x4000), 'backward', 'wraps around ±180°')
})

const transformPoint = (matrix, point) => [0, 1, 2].map(component =>
    matrix[3][component] + point.reduce((sum, value, axis) => sum + value * matrix[axis][component], 0))

const forwardInWorld = (matrix, cameraMatrix) => [0, 1, 2].map(axis =>
    matrix[0].slice(0, 3).reduce((sum, value, component) => sum + value * cameraMatrix[axis][component], 0))

const animationValue = (animation, part, axis, frame) => {
    const index = (3 + part * 3 + axis) * 2
    const value = animation.values[animation.indices[index + 1] + Math.min(frame, animation.indices[index] - 1)]
    return value > 32767 ? value - 65536 : value
}

const armHandMatrix = (math, shoulderMatrix, animation, frame) => {
    let matrix = shoulderMatrix
    // These are the actual right arm, forearm and hand offsets in Mario's geo.
    for (const [part, length] of [[9, 0], [10, 65], [11, 60]]) {
        const joint = math.Mat4(), result = math.Mat4()
        math.mtxf_rotate_xyz_and_translate(joint, [length, 0, 0],
            [0, 1, 2].map(axis => animationValue(animation, part, axis, frame)))
        math.mtxf_mul(result, joint, matrix)
        matrix = result
    }
    return matrix
}

const assertBarrelHits = (handMatrix, muzzle, cameraMatrix, target, label) => {
    const origin = transformPoint(handMatrix, [muzzle[0], muzzle[1], 0])
    const forward = handMatrix[0].slice(0, 3)
    const targetView = transformPoint(cameraMatrix, target)
    const delta = targetView.map((value, axis) => value - origin[axis])
    const along = delta.reduce((sum, value, axis) => sum + value * forward[axis], 0)
        / forward.reduce((sum, value) => sum + value * value, 0)
    const miss = Math.hypot(...delta.map((value, axis) => value - along * forward[axis]))
    assert.ok(along > 0, `${label}: target is ahead of the muzzle`)
    assert.ok(miss < 1e-6, `${label}: barrel ray misses target by ${miss} units`)
}

const aimScene = (math, position, rotation, scale, camera) => {
    const world = math.Mat4(), view = math.Mat4(), shoulder = math.Mat4()
    math.mtxf_rotate_xyz_and_translate(world, position, rotation)
    math.mtxf_scale_vec3f(world, world, [scale, scale, scale])
    math.mtxf_lookat(view, camera.pos, camera.focus, camera.roll || 0)
    math.mtxf_mul(shoulder, world, view)
    return { shoulder, view }
}

test('every gun barrel points through the target in idle and strafing animations', () => {
    const r = runtime()
    const math = r.load('engine/math_util.js')
    const { createAimAnimation, alignAimArm } = r.load('game/MarioAimAnimation.js')
    const { gMarioAnimData } = r.load('actors/mario/marioAnimData.js')
    const { mario_gun_dls } = r.load('actors/mario_gun/model.inc.js')
    const pose = gMarioAnimData[0x67]
    const animations = [
        createAimAnimation(pose, pose, 10),
        createAimAnimation(gMarioAnimData[0x48], pose, 10),
        createAimAnimation(gMarioAnimData[0x48], pose, 10, { reverse: true }),
        createAimAnimation(gMarioAnimData[0x7F], pose, 10),
        createAimAnimation(gMarioAnimData[0x80], pose, 10),
    ]
    const scenes = [
        { pos: [-220, 90, 450], rotation: [2300, 16000, -1800], scale: 1,
            camera: { pos: [800, 900, -1600], focus: [200, 150, 400], roll: 0.17 }, target: [1000, 340, 1650] },
        { pos: [760, 430, -250], rotation: [-1900, -32000, 4200], scale: 0.75,
            camera: { pos: [-1200, 700, 1100], focus: [100, 300, -200], roll: -0.22 }, target: [-350, -100, -1700] },
        { pos: [150, -40, 800], rotation: [3000, -12000, 1600], scale: 1.3,
            camera: { pos: [1400, 100, 2200], focus: [0, 140, 0] }, target: [150, 1200, 800] },
    ]
    for (const [id, model] of Object.entries(mario_gun_dls)) {
        for (const scene of scenes) for (const animation of animations) {
            for (const frame of [0, Math.floor(animation.unk08 / 2), animation.unk08 - 1]) {
                const { shoulder, view } = aimScene(math, scene.pos, scene.rotation, scene.scale, scene.camera)
                const translation = [...shoulder[3]]
                alignAimArm(shoulder, view, scene.target, 0, model.muzzle[1])
                assert.deepEqual([...shoulder[3]], translation, 'the shoulder stays attached to Mario')
                for (const axis of shoulder.slice(0, 3)) {
                    assert.ok(Math.abs(Math.hypot(...axis.slice(0, 3)) - scene.scale) < 1e-10, 'Mario scale is retained')
                }
                assertBarrelHits(armHandMatrix(math, shoulder, animation, frame), model.muzzle, view, scene.target,
                    `${id}, frame ${frame}, scale ${scene.scale}`)
            }
        }
    }
    assert.equal(animations[2].flags & 2, 2, 'backward strafing retains reverse playback')
    assert.equal(animations[1].unk08, gMarioAnimData[0x48].unk08, 'leg animation retains its walk cycle')
    for (const animation of [animations[1], animations[2]]) {
        for (const frame of [0, 20, 60]) for (const part of [12, 13, 14, 17, 18]) for (let axis = 0; axis < 3; axis++) {
            assert.equal(animationValue(animation, part, axis, frame), animationValue(gMarioAnimData[0x48], part, axis, frame),
                `leg ${part} remains animated while aiming`)
        }
    }
    assert.ok([9, 10, 11].some(part => [0, 1, 2].some(axis => animationValue(pose, part, axis, 4) !== 0)),
        'the punch arm contains rotations that need correction')
})

test('free aim follows a horizontal yaw through rotated cameras and close targets stay finite', () => {
    const r = runtime()
    const math = r.load('engine/math_util.js')
    const { alignAimArm } = r.load('game/MarioAimAnimation.js')
    const scene = { pos: [240, 180, -380], rotation: [4000, 7000, -3000], scale: 0.9,
        camera: { pos: [950, 700, -1250], focus: [150, 100, 80], roll: 0.3 } }
    for (const yaw of [0, 0x4000, -0x4000, 0x8000, -0x8000 + 1]) {
        const { shoulder, view } = aimScene(math, scene.pos, scene.rotation, scene.scale, scene.camera)
        alignAimArm(shoulder, view, null, yaw, 61)
        const worldForward = forwardInWorld(shoulder, view)
        const radians = yaw * Math.PI / 0x8000
        const expected = [Math.sin(radians) * scene.scale, 0, Math.cos(radians) * scene.scale]
        assert.ok(Math.hypot(...worldForward.map((value, axis) => value - expected[axis])) < 1e-10,
            `free aim follows yaw ${yaw}`)
    }
    for (const target of [scene.pos, [240, 181, -380], [240, 180, -379], [240, -820, -380]]) {
        const { shoulder, view } = aimScene(math, scene.pos, scene.rotation, scene.scale, scene.camera)
        alignAimArm(shoulder, view, target, 0x8000, 70)
        assert.ok(shoulder.flat().every(Number.isFinite), 'close and vertical targets produce finite matrices')
    }
})

test('the shoulder geo tracks current enemy position and Mario movement between aim updates', () => {
    const { weapon, add, object, mario, r } = weaponRuntime()
    const math = r.load('engine/math_util.js')
    const enemyObject = add(5, object(200, 1500, 1 << 15, { hitboxHeight: 180, hitboxDownOffset: 20 }))
    mario.action = ACT_GUN_AIM
    weapon.updateWeaponAim(mario, {})
    const cachedPosition = [...weapon.weaponState.target.pos]
    const camera = { pos: [750, 780, -1200], focus: [100, 150, 500], roll: 0.15 }
    const scene = position => aimScene(math, position, [2100, -6000, 1400], 1, camera)
    const first = scene([40, 130, 30])
    r.linker.GeoRenderer = { gCurGraphNodeObject: { object: mario.marioObj }, gCurGraphNodeCamera: { matrixPtr: first.view } }

    for (const movement of [
        { shoulder: [40, 130, 30], target: [200, 160, 1500] },
        { shoulder: [-100, 180, 110], target: [-650, 550, 1300] },
        { shoulder: [150, 90, -60], target: [900, -200, 1600] },
    ]) {
        enemyObject.rawData[6] = movement.target[0]
        enemyObject.rawData[7] = movement.target[1]
        enemyObject.rawData[8] = movement.target[2]
        const { shoulder, view } = scene(movement.shoulder)
        r.linker.GeoRenderer.gCurGraphNodeCamera.matrixPtr = view
        weapon.geo_mario_aim_arm(1, {}, shoulder)
        const targetCentre = [movement.target[0], movement.target[1] - 20 + 90, movement.target[2]]
        // The corrected descendant arm is straight, placing the wrist 125 units out.
        const wrist = math.Mat4(), hand = math.Mat4()
        math.mtxf_translate(wrist, [125, 0, 0])
        math.mtxf_mul(hand, wrist, shoulder)
        assertBarrelHits(hand, [240, 61], view, targetCentre, 'moving target')
        assert.deepEqual([...weapon.weaponState.target.pos], cachedPosition, 'the test uses a cached target snapshot')
    }

    const { shoulder, view } = scene([40, 130, 30])
    const untouched = shoulder.map(axis => [...axis])
    weapon.geo_mario_aim_arm(0, {}, shoulder)
    assert.deepEqual(shoulder.map(axis => [...axis]), untouched, 'layout creation does not mutate the arm')
    mario.action = ACT_IDLE
    weapon.geo_mario_aim_arm(1, {}, shoulder)
    assert.deepEqual(shoulder.map(axis => [...axis]), untouched, 'normal Mario animations are untouched')
    mario.action = ACT_GUN_AIM
    r.linker.GeoRenderer.gCurGraphNodeObject = { object: {} }
    weapon.geo_mario_aim_arm(1, {}, shoulder)
    assert.deepEqual(shoulder.map(axis => [...axis]), untouched, 'other rendered objects are untouched')

    r.linker.GeoRenderer.gCurGraphNodeObject = { object: mario.marioObj }
    weapon.stopWeaponAim()
    enemyObject.activeFlags = 0
    const expectedYaw = Math.atan2(r.linker.Camera.gLakituState.focus[0] - r.linker.Camera.gLakituState.pos[0],
        r.linker.Camera.gLakituState.focus[2] - r.linker.Camera.gLakituState.pos[2])
    weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    r.linker.Camera.gLakituState.focus = [1000, 100, -800]
    weapon.geo_mario_aim_arm(1, {}, shoulder)
    // A camera update after firing must not change that frame's barrel heading.
    const worldForward = forwardInWorld(shoulder, view)
    assert.ok(Math.abs(worldForward[1]) < 1e-10)
    assert.ok(Math.abs(Math.atan2(worldForward[0], worldForward[2]) - expectedYaw) < 1e-10)
})

test('a killing shot keeps the muzzle flash pointed at its victim until the next aim update', () => {
    const { weapon, add, object, mario, r } = weaponRuntime()
    const math = r.load('engine/math_util.js')
    const victim = add(5, object(600, 1200, 1 << 15, { weaponHealth: 25 }))
    mario.action = ACT_GUN_AIM
    weapon.updateWeaponAim(mario, { buttonPressedB: true, buttonDownB: true })
    assert.equal(victim.weaponDefeated, true)
    assert.equal(weapon.weaponState.target, null, 'the gameplay lock is released after the kill')
    assert.equal(weapon.weaponState.aimTarget, victim, 'the rendered shot retains its target')
    assert.equal(weapon.geo_mario_gun(1, { flags: 0 })[1], 'flash')

    const camera = { pos: [-700, 600, -1500], focus: [100, 150, 500], roll: -0.1 }
    const { shoulder, view } = aimScene(math, [40, 130, 30], [1300, -5000, 900], 1, camera)
    r.linker.GeoRenderer = { gCurGraphNodeObject: { object: mario.marioObj }, gCurGraphNodeCamera: { matrixPtr: view } }
    weapon.geo_mario_aim_arm(1, {}, shoulder)
    const wrist = math.Mat4(), hand = math.Mat4()
    math.mtxf_translate(wrist, [125, 0, 0])
    math.mtxf_mul(hand, wrist, shoulder)
    assertBarrelHits(hand, [240, 61], view, [600, 50, 1200], 'killing shot')

    weapon.updateWeaponAim(mario, {})
    assert.equal(weapon.weaponState.aimTarget, null, 'the next aim update resumes free aim')
    weapon.stopWeaponAim()
    assert.equal(weapon.weaponState.aimTarget, null)
})

test('shots, reloads, dry fire and switching each make their sound', () => {
    const { weapon, add, object, mario, sounds } = weaponRuntime()
    add(5, object(0, 1000, 1 << 15))
    mario.action = ACT_GUN_AIM
    const fire = { buttonPressedB: true, buttonDownB: true }
    weapon.updateWeaponAim(mario, fire)
    assert.deepEqual(sounds.splice(0), ['pistol'])
    weapon.updateWeaponHud({ buttonPressedNextWeapon: true })
    weapon.updateWeaponHud({ buttonPressedNextWeapon: true })
    weapon.updateWeaponHud({ buttonPressedNextWeapon: true })
    assert.deepEqual(sounds.splice(0), ['switch', 'switch', 'switch'])
    assert.equal(weapon.currentWeapon().id, 'smg')

    // Empty the SMG: the last round starts a reload (magazine out).
    weapon.weaponState.ammo[3].clip = 1
    weapon.updateWeaponAim(mario, fire)
    assert.deepEqual(sounds.splice(0), ['reload', 'smg'])
    weapon.updateWeaponAim(mario, fire)
    assert.deepEqual(sounds.splice(0), ['empty'], 'pulling the trigger mid-reload clicks')
    while (weapon.weaponState.ammo[3].reload > 0) weapon.updateWeaponAim(mario, {})
    assert.deepEqual(sounds.splice(0), ['ready'])

    // Single-shot guns work the pump/bolt inside their own shot sound.
    weapon.weaponState.index = 2
    weapon.updateWeaponAim(mario, fire)
    while (weapon.weaponState.ammo[2].reload > 0) weapon.updateWeaponAim(mario, {})
    assert.deepEqual(sounds.splice(0), ['shotgun'])
})

test('Mario aims and fires through ordinary jumps and falls, turning his body but not his momentum', () => {
    const { weapon, add, object, mario, sounds, r } = weaponRuntime()
    const { gMarioAnimData } = r.load('actors/mario/marioAnimData.js')
    const jumpAnim = gMarioAnimData[0x4D]
    mario.animation = { animList: gMarioAnimData }
    mario.marioObj.gfx = { angle: [0, 0, 0], animInfo: { animID: 0x4D, curAnim: jumpAnim, animFrame: 0 } }
    const goomba = add(5, object(1000, 0, 1 << 15))   // off to Mario's left
    const held = { buttonDownAim: true }
    const setAction = (m, action) => { m.action = action }

    // B is the trigger, so it can't also kick or dive.
    mario.action = ACT_JUMP
    mario.input = INPUT_B_PRESSED | 1
    weapon.beginAirAim(mario, held)
    assert.equal(mario.input, 1)
    mario.input = 0
    weapon.beginAirAim(mario, {})
    mario.input = INPUT_B_PRESSED
    weapon.beginAirAim(mario, {})
    assert.equal(mario.input, INPUT_B_PRESSED, 'B still kicks without the aim button')
    mario.input = 0

    weapon.updateAirAim(mario, setAction, held)
    assert.equal(weapon.isAiming(), true)
    assert.equal(weapon.weaponState.target.object, goomba)
    assert.equal(weapon.geo_mario_gun(1, { flags: 0 })[0], 'pistol', 'the gun shows mid-air')
    // The body turns toward the target a step at a time, from the next frame.
    weapon.updateAirAim(mario, setAction, held)
    assert.equal(mario.marioObj.gfx.angle[1], 0x1800, 'the body turns toward the target a step at a time')
    for (let i = 0; i < 5; i++) weapon.updateAirAim(mario, setAction, held)
    assert.equal(mario.marioObj.gfx.angle[1], 0x4000)
    assert.equal(mario.faceAngle[1], 0, 'momentum keeps its direction')

    // The jump plays as normal: only the arm channels are taken over for the gun.
    const pose = mario.marioObj.gfx.animInfo.curAnim
    assert.notEqual(pose, jumpAnim)
    assert.equal(pose.unk08, jumpAnim.unk08)
    for (let ch = 0; ch < jumpAnim.indices.length / 2; ch++) {
        const part = Math.floor((ch - 3) / 3), arm = part >= 4 && part <= 11
        if (!arm) assert.deepEqual([pose.indices[ch * 2], pose.indices[ch * 2 + 1]], [jumpAnim.indices[ch * 2], jumpAnim.indices[ch * 2 + 1]], `channel ${ch} untouched`)
        else assert.equal(pose.indices[ch * 2], 1, `arm channel ${ch} rigged`)
    }

    weapon.updateAirAim(mario, setAction, { ...held, buttonPressedB: true, buttonDownB: true })
    assert.deepEqual(sounds.splice(0), ['pistol'])
    assert.equal(goomba.weaponHealth, 75)

    for (const action of [ACT_DOUBLE_JUMP, ACT_TRIPLE_JUMP, ACT_SPECIAL_TRIPLE_JUMP, ACT_BACKFLIP, ACT_SIDE_FLIP,
        ACT_FREEFALL, ACT_LONG_JUMP, ACT_WALL_KICK_AIR, ACT_TOP_OF_POLE_JUMP, ACT_STEEP_JUMP]) {
        mario.action = action
        assert.equal(weapon.canAimInAir(mario, held), true)
    }
    for (const action of [ACT_GROUND_POUND, ACT_BACKWARD_AIR_KB, ACT_DIVE]) {
        mario.action = action
        assert.equal(weapon.canAimInAir(mario, held), false)
    }
    mario.action = ACT_JUMP
    mario.heldObj = {}
    assert.equal(weapon.canAimInAir(mario, held), false, 'not while carrying something')
    mario.heldObj = null

    // Landings keep the gun out without ending the jump, so the next can chain...
    weapon.updateAirAim(mario, setAction, held)
    mario.action = ACT_JUMP_LAND
    mario.input = 4   // off-floor input left over from the landing frame
    weapon.updateAirAim(mario, setAction, held)
    assert.equal(mario.action, ACT_JUMP_LAND)
    assert.equal(weapon.isAiming(), true)
    mario.input = 0
    assert.equal(weapon.canStartAiming(mario, held), false, 'the landing is not cut short')
    // ...and once the landing is over he's back to aiming on the ground, facing the target.
    mario.action = ACT_JUMP_LAND_STOP
    weapon.updateAirAim(mario, setAction, held)
    assert.equal(mario.action, ACT_GUN_AIM)
    assert.equal(mario.faceAngle[1], 0x4000)
    assert.equal(mario.marioObj.gfx.animInfo.curAnim, jumpAnim, 'the jump animation is restored')
    assert.equal(weapon.weaponState.target.object, goomba, 'the lock carries over')

    // Releasing the button mid-air, or a knockback, puts the gun away.
    mario.action = ACT_JUMP
    weapon.updateAirAim(mario, setAction, held)
    weapon.updateAirAim(mario, setAction, {})
    assert.equal(weapon.isAiming(), false)
    assert.equal(weapon.weaponState.target, null)
    assert.equal(mario.marioObj.gfx.animInfo.curAnim, jumpAnim)
    weapon.updateAirAim(mario, setAction, held)
    mario.action = ACT_BACKWARD_AIR_KB
    assert.equal(weapon.isAiming(), false)
    weapon.updateAirAim(mario, setAction, held)
    assert.equal(mario.action, ACT_BACKWARD_AIR_KB)
    assert.equal(weapon.weaponState.target, null)
})

// Forward kinematics of Mario's skeleton the way GeoRenderer draws it: the object
// transform, the geo's 0.25 scale, then each animated part from the animation.
const SKELETON = [[0, 0, 0, -1], [0, 0, 0, 0], [68, 0, 0, 1], [87, 0, 0, 2], [67, -10, 79, 2], [0, 0, 0, 4],
    [65, 0, 0, 5], [60, 0, 0, 6], [68, -10, -79, 2], [0, 0, 0, 8], [65, 0, 0, 9], [60, 0, 0, 10]]
function skeleton(M, anim, frame, pos, yaw) {
    const read = ch => {
        const v = anim.values[anim.indices[ch * 2 + 1] + Math.min(frame, anim.indices[ch * 2] - 1)]
        return v > 32767 ? v - 65536 : v
    }
    const object = M.Mat4(), scaled = M.Mat4()
    M.mtxf_rotate_zxy_and_translate(object, pos, [0, yaw, 0])
    M.mtxf_scale_vec3f(scaled, object, [0.25, 0.25, 0.25])
    const parts = []
    const part = (i, parentMatrix) => {
        const [x, y, z] = SKELETON[i]
        const t = i === 0 ? [read(0), read(1), read(2)] : [x, y, z]
        const local = M.Mat4(), out = M.Mat4()
        M.mtxf_rotate_xyz_and_translate(local, t, [0, 1, 2].map(a => read(3 + i * 3 + a)))
        M.mtxf_mul(out, local, parentMatrix)
        return parts[i] = out
    }
    part(0, scaled)
    for (let i = 1; i <= 3; i++) part(i, parts[SKELETON[i][3]])
    return { parts, arms: () => { for (let i = 4; i < SKELETON.length; i++) part(i, parts[SKELETON[i][3]]) } }
}

test('the gun arm points the barrel at the target, upright, in every aiming pose', () => {
    const { weapon, mario, r } = weaponRuntime()
    const M = r.load('engine/math_util.js')
    const { rigArms } = r.load('game/MarioAimRig.js')
    const { pinParts, AIM_PARTS } = r.load('game/MarioAimAnimation.js')
    const { gMarioAnimData: A } = r.load('actors/mario/marioAnimData.js')
    const punch = A[0x67]
    const poses = {
        standing: [rigArms(punch), [10]],
        strafing: [rigArms(pinParts(A[0x48], punch, 10, AIM_PARTS)), [0, 20, 40, 60]],
        sidestep: [rigArms(pinParts(A[0x7F], punch, 10, AIM_PARTS)), [0, 10, 20]],
        jumping: [rigArms(A[0x4D]), [0, 5, 11]],
        'double jump': [rigArms(A[0x50]), [0, 3, 5]],
    }
    const camera = M.Mat4()
    M.mtxf_lookat(camera, [300, 400, -900], [0, 100, 0], 0)
    const cameraMatrix = M.Mat4()
    M.mtxf_copy(cameraMatrix, camera)
    const marioPos = [0, 0, 0]
    for (const [name, [rig, frames]] of Object.entries(poses)) {
        for (const frame of frames) for (const [yaw, target] of [[0, [200, 150, 2500]], [0x2000, [2000, -300, 1500]], [-0x4000, [-2500, 600, -400]]]) {
            weapon.weaponState.aimPoint = target
            weapon.weaponState.aimDir = [0, 0, 1]
            const body = skeleton(M, rig, frame, marioPos, yaw)
            const torsoCam = M.Mat4()
            M.mtxf_mul(torsoCam, body.parts[2], cameraMatrix)
            r.linker.GeoRenderer = { gCurAnimData: rig.values, gCurrAnimFrame: frame, gCurGraphNodeCamera: { matrixPtr: cameraMatrix } }
            weapon.geo_mario_aim_arms(1, {}, torsoCam)
            body.arms()
            const hand = body.parts[11]
            const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l) }
            const barrel = unit(hand[0].slice(0, 3)), gunUp = unit(hand[1].slice(0, 3))
            const toTarget = unit(target.map((v, i) => v - hand[3][i]))
            const error = Math.acos(Math.min(1, barrel.reduce((s, v, i) => s + v * toTarget[i], 0))) * 180 / Math.PI
            assert.ok(error < 3, `${name} frame ${frame} yaw ${yaw}: barrel ${error.toFixed(1)}° off target`)
            assert.ok(gunUp[1] > 0.9, `${name} frame ${frame} yaw ${yaw}: gun upright (${gunUp[1].toFixed(2)})`)
        }
    }
    // Other Mario-shaped models (Luigi) aren't rigged and are left alone.
    r.linker.GeoRenderer.gCurAnimData = punch.values
    assert.equal(weapon.geo_mario_aim_arms(1, {}, M.Mat4()), null)
})

test('two-handed guns put the left hand on the barrel ahead of the right', () => {
    const { weapon, r } = weaponRuntime()
    const M = r.load('engine/math_util.js')
    const { rigArms } = r.load('game/MarioAimRig.js')
    const { gMarioAnimData: A } = r.load('actors/mario/marioAnimData.js')
    const camera = M.Mat4()
    M.mtxf_lookat(camera, [300, 400, -900], [0, 100, 0], 0)
    const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l) }
    const grips = {}
    const { WEAPONS } = r.load('game/Weapons.js')
    for (const id of ['pistol', 'shotgun', 'm4', 'sniper']) {
        weapon.weaponState.index = WEAPONS.findIndex(w => w.id === id)
        const gun = weapon.currentWeapon()
        // The squared-up stance (first person) for two-handed guns, the pistol stance otherwise.
        const rig = rigArms(A[gun.foregrip ? 0xC2 : 0x67])
        for (const [yaw, target] of [[0, [200, 150, 2500]], [0x2000, [2000, -300, 1500]]]) {
            weapon.weaponState.aimPoint = target
            const body = skeleton(M, rig, gun.foregrip ? 0 : 10, [0, 0, 0], yaw)
            const torsoCam = M.Mat4()
            M.mtxf_mul(torsoCam, body.parts[2], camera)
            r.linker.GeoRenderer = { gCurAnimData: rig.values, gCurrAnimFrame: 0, gCurGraphNodeCamera: { matrixPtr: camera } }
            weapon.geo_mario_aim_arms(1, {}, torsoCam)
            body.arms()
            const right = body.parts[11], left = body.parts[7]
            const barrel = unit(right[0].slice(0, 3)), gunUp = unit(right[1].slice(0, 3))
            const toTarget = unit(target.map((v, i) => v - right[3][i]))
            assert.ok(barrel.reduce((s, v, i) => s + v * toTarget[i], 0) > Math.cos(3 * Math.PI / 180), `${id} on target`)
            // The left wrist in the right hand's space (model units: world ÷ 0.25).
            const rel = left[3].slice(0, 3).map((v, i) => (v - right[3][i]) * 4)
            const along = rel.reduce((s, v, i) => s + v * barrel[i], 0), height = rel.reduce((s, v, i) => s + v * gunUp[i], 0)
            if (!gun.foregrip) {
                assert.ok(Math.hypot(...rel) > 150, `${id} is one-handed`)
                continue
            }
            grips[`${id}@${yaw}`] = Math.round(along)
            assert.ok(along >= 95 && along <= gun.foregrip[0] + 1, `${id}: left hand ${along.toFixed(0)} along the barrel`)
            assert.ok(Math.abs(height - gun.foregrip[1]) < 3, `${id}: left hand ${height.toFixed(0)} high`)
            const off = Math.hypot(...rel.map((v, i) => v - barrel[i] * along - gunUp[i] * height))
            assert.ok(off < 3, `${id}: left hand ${off.toFixed(1)} off the gun's centre line`)
        }
    }
    console.log('left grips', JSON.stringify(grips))
})

test('mid-jump the jump animation plays and both hands stay on a two-handed gun', () => {
    const { weapon, r } = weaponRuntime()
    const M = r.load('engine/math_util.js')
    const { rigArms } = r.load('game/MarioAimRig.js')
    const { gMarioAnimData: A } = r.load('actors/mario/marioAnimData.js')
    const { WEAPONS } = r.load('game/Weapons.js')
    weapon.weaponState.index = WEAPONS.findIndex(w => w.id === 'shotgun')
    const camera = M.Mat4()
    M.mtxf_lookat(camera, [300, 400, -900], [0, 100, 0], 0)
    const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l) }
    for (const [id, frames] of [[0x4D, [0, 2, 5, 8, 11]], [0x50, [0, 3]], [0x4C, [0, 4, 8]], [0x13, [0, 4, 8]]]) {
        const rig = rigArms(A[id])
        for (const frame of frames) {
            weapon.weaponState.aimPoint = [300, 200, 2500]
            const body = skeleton(M, rig, frame, [0, 0, 0], 0)
            const torsoCam = M.Mat4()
            M.mtxf_mul(torsoCam, body.parts[2], camera)
            r.linker.GeoRenderer = { gCurAnimData: rig.values, gCurrAnimFrame: frame, gCurGraphNodeCamera: { matrixPtr: camera } }
            weapon.geo_mario_aim_arms(1, {}, torsoCam)
            body.arms()
            const right = body.parts[11], left = body.parts[7]
            const barrel = unit(right[0].slice(0, 3)), gunUp = unit(right[1].slice(0, 3))
            const rel = left[3].slice(0, 3).map((v, i) => (v - right[3][i]) * 4)
            const along = rel.reduce((s, v, i) => s + v * barrel[i], 0), height = rel.reduce((s, v, i) => s + v * gunUp[i], 0)
            const off = Math.hypot(...rel.map((v, i) => v - barrel[i] * along - gunUp[i] * height))
            assert.ok(along >= 30 && off < 3, `anim ${id} frame ${frame}: left hand ${along.toFixed(0)} along, ${off.toFixed(1)} off the gun`)
        }
    }
})

test('mid-jump Mario fires at the lock only if he can point at it, else straight ahead of his chest', () => {
    const { weapon, add, object, mario, r } = weaponRuntime()
    const { torsoInWorld, canPointAt } = r.load('game/MarioAimRig.js')
    const { gMarioAnimData: A } = r.load('actors/mario/marioAnimData.js')
    // Standing upright his chest faces his yaw; partway through a triple jump's flip it doesn't.
    const upright = torsoInWorld(A[0xC2], 0, [0, 0, 0], [0, 0, 0])
    assert.ok(upright.forward[2] > 0.95, 'the chest faces +Z at yaw 0')
    assert.ok(upright.shoulder[1] > 40 && upright.shoulder[0] < 0, 'the gun shoulder is up and to his right')
    const flipping = Array.from({ length: A[0xC1].unk08 }, (_, f) => torsoInWorld(A[0xC1], f, [0, 0, 0], [0, 0, 0]).forward)
    assert.ok(flipping.some(f => f[2] < 0), 'the triple jump turns his chest away mid-flip')
    // A freshly started animation sits at frame -1 before its first step.
    assert.deepEqual(torsoInWorld(A[0x4C], -1, [0, 0, 0], [0, 0, 0]).forward.map(v => v.toFixed(3)),
        torsoInWorld(A[0x4C], 0, [0, 0, 0], [0, 0, 0]).forward.map(v => v.toFixed(3)))
    assert.equal(canPointAt(upright, [0, 100, 1000]), true)
    assert.equal(canPointAt(upright, [0, 100, -1000]), false)

    const locked = add(5, object(0, 1000, 1 << 15))      // ahead of Mario's yaw
    const behind = add(5, object(0, -900, 1 << 15))      // where his chest faces mid-flip
    const fire = { buttonPressedB: true, buttonDownB: true }
    mario.action = ACT_TRIPLE_JUMP
    const away = { forward: [0, 0, -1], up: [0, 1, 0], shoulder: [0, 100, 0] }
    weapon.updateWeaponAim(mario, {}, 0, away)
    assert.equal(weapon.weaponState.target.object, locked, 'the lock is kept for when he comes round')
    assert.equal(weapon.weaponState.aimPoint, null, 'the arms point ahead of his chest, not at the lock')
    assert.deepEqual([...weapon.weaponState.aimDir], [0, 0, -1])
    weapon.updateWeaponAim(mario, fire, 0, away)
    assert.equal(locked.weaponHealth, 100)
    assert.equal(behind.weaponHealth, 75, 'the shot goes straight ahead and hits what is there')

    // Facing the lock, the shot goes to it.
    for (let i = 0; i < 9; i++) weapon.updateWeaponAim(mario, {}, 0, upright)
    weapon.updateWeaponAim(mario, fire, 0, { ...upright, shoulder: [0, 100, 0] })
    assert.equal(locked.weaponHealth, 75)
    assert.deepEqual([...weapon.weaponState.aimPoint], [...weapon.weaponState.target.pos])

    // Upside down mid-flip the shot goes into the sky and hits nothing.
    for (let i = 0; i < 9; i++) weapon.updateWeaponAim(mario, {}, 0, away)
    const clip = weapon.weaponState.ammo[0].clip
    weapon.updateWeaponAim(mario, fire, 0, { forward: [0, 1, 0], up: [0, 0, 1], shoulder: [0, 100, 0] })
    assert.equal(weapon.weaponState.ammo[0].clip, clip - 1, 'the gun still fires')
    assert.equal(locked.weaponHealth + behind.weaponHealth, 150)
})

test('a side flip keeps its flip while the body turns toward the target', () => {
    const { weapon, add, object, mario, r } = weaponRuntime()
    const { gMarioAnimData: A } = r.load('actors/mario/marioAnimData.js')
    mario.animation = { animList: A }
    mario.marioObj.gfx = { angle: [0, 0x8000 - 0x10000, 0], animInfo: { animID: 0xBF, curAnim: A[0xBF], animFrame: 3 } }
    add(5, object(1000, 0, 1 << 15))
    mario.action = ACT_SIDE_FLIP
    const held = { buttonDownAim: true }
    weapon.updateAirAim(mario, () => {}, held)
    // The flip's own half turn stays; the turn toward the target is added on top.
    for (let i = 0; i < 6; i++) {
        mario.marioObj.gfx.angle[1] = -0x8000   // the side flip sets this each frame
        weapon.updateAirAim(mario, () => {}, held)
    }
    assert.equal(weapon.weaponState.airYaw, 0x4000)
    assert.equal(mario.marioObj.gfx.angle[1], -0x4000, 'half turn + quarter turn to the target')
    // An action that leaves the drawn yaw alone doesn't make the turn compound.
    weapon.updateAirAim(mario, () => {}, held)
    weapon.updateAirAim(mario, () => {}, held)
    assert.equal(mario.marioObj.gfx.angle[1], -0x4000)
})
