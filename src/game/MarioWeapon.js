import { oPosX, oPosY, oPosZ, oInteractType, oInteractStatus, oAction, BOBOMB_ACT_EXPLODE } from "../include/object_constants"
import { GEO_CONTEXT_RENDER, GRAPH_RENDER_ACTIVE, GRAPH_RENDER_INVISIBLE } from "../engine/graph_node"
import { LAYER_OPAQUE } from "../engine/GeoLayout"
import { INTERACT_BOUNCE_TOP, INTERACT_BOUNCE_TOP2, INTERACT_HIT_FROM_BELOW, INTERACT_KOOPA,
    INTERACT_BULLY, INTERACT_MR_BLIZZARD, ATTACK_KICK_OR_TRIP, INT_STATUS_INTERACTED, INT_STATUS_WAS_ATTACKED } from "./Interaction"
import { mario_gun_dls } from "../actors/mario_gun/model.inc"
import { ACT_GUN_AIM, ACT_GROUP_MASK, ACT_GROUP_STATIONARY, ACT_GROUP_MOVING, ACT_FLAG_ALLOW_FIRST_PERSON,
    ACT_FLAG_INVULNERABLE, ACT_FLAG_SHORT_HITBOX, ACT_FLAG_RIDING_SHELL, ACT_FLAG_DIVING,
    ACT_FLAG_BUTT_OR_STOMACH_SLIDE, INPUT_OFF_FLOOR, INPUT_B_PRESSED, ACT_JUMP, ACT_DOUBLE_JUMP, ACT_TRIPLE_JUMP,
    ACT_SPECIAL_TRIPLE_JUMP, ACT_BACKFLIP, ACT_SIDE_FLIP, ACT_LONG_JUMP, ACT_WALL_KICK_AIR, ACT_FREEFALL,
    ACT_TOP_OF_POLE_JUMP, ACT_STEEP_JUMP, ACT_JUMP_LAND, ACT_FREEFALL_LAND, ACT_DOUBLE_JUMP_LAND, ACT_SIDE_FLIP_LAND,
    ACT_TRIPLE_JUMP_LAND, ACT_BACKFLIP_LAND, ACT_LONG_JUMP_LAND } from "./Mario"
import { rigArms, rigForValues, writeRotation, writeAnimated, solveGunArm, solveTwoHanded, torsoInWorld, canPointAt,
    LEFT_ARM, RIGHT_ARM } from "./MarioAimRig"
import { int16 } from "../utils"
import { play_gun_sound } from "../audio/external"
import * as Targeting from "./WeaponTargeting"
import { WEAPONS, ENEMY_HEALTH, HEAVY_ENEMY_HEALTH, newAmmo, nextWeapon, pullTrigger, shotHits } from "./Weapons"

// Objects Mario can attack that also fight back. Hazards (flames, Amps) and
// passive objects are left out so the lock always lands on an enemy.
const ENEMY_INTERACTIONS = INTERACT_BOUNCE_TOP | INTERACT_BOUNCE_TOP2 | INTERACT_HIT_FROM_BELOW
    | INTERACT_KOOPA | INTERACT_BULLY | INTERACT_MR_BLIZZARD
// Bob-ombs and Chuckyas interact as grabbable objects, so name them directly.
const ENEMY_BEHAVIORS = ['bhvBobomb', 'bhvChuckya']
const ENEMY_LISTS = [2, 4, 5] // OBJ_LIST_DESTRUCTIVE, OBJ_LIST_GENACTOR, OBJ_LIST_PUSHABLE

export const weaponState = { index: 0, ammo: newAmmo(), target: null, aimTarget: null, aimYaw: 0, flash: 0, hudFrames: 0, airAim: false, airYaw: 0,
    airAimYaw: 0, airGfx: null, aimPoint: null, aimDir: [0, 0, 1] }
export const currentWeapon = () => WEAPONS[weaponState.index]

// Every jump keeps its SM64 physics while Mario aims, and so do the landings
// between them, so double and triple jumps still chain. Read on use:
// Mario.js isn't initialised when this module loads.
const airAimActions = () => [ACT_JUMP, ACT_DOUBLE_JUMP, ACT_TRIPLE_JUMP, ACT_SPECIAL_TRIPLE_JUMP, ACT_BACKFLIP,
    ACT_SIDE_FLIP, ACT_LONG_JUMP, ACT_WALL_KICK_AIR, ACT_FREEFALL, ACT_TOP_OF_POLE_JUMP, ACT_STEEP_JUMP]
const landingActions = () => [ACT_JUMP_LAND, ACT_FREEFALL_LAND, ACT_DOUBLE_JUMP_LAND, ACT_SIDE_FLIP_LAND,
    ACT_TRIPLE_JUMP_LAND, ACT_BACKFLIP_LAND, ACT_LONG_JUMP_LAND]
const isJumpAction = m => airAimActions().includes(m.action) || (weaponState.airAim && landingActions().includes(m.action))
export const canAimInAir = (m, input = window.playerInput) =>
    Boolean(input.buttonDownAim) && !m.heldObj && isJumpAction(m)

// Derived from Mario's action so knockbacks and warps put the gun away too.
export const isAiming = () => {
    const m = gLinker.LevelUpdate && gLinker.LevelUpdate.gMarioState
    return Boolean(m && (m.action === ACT_GUN_AIM || (weaponState.airAim && isJumpAction(m))))
}

const hasBehavior = (object, name) => Boolean(object.behavior) && object.behavior === gLinker.behaviors[name]

const isEnemy = object => Boolean(object.activeFlags & 1) && !object.weaponDefeated
    && (Boolean(object.rawData[oInteractType] & ENEMY_INTERACTIONS) || ENEMY_BEHAVIORS.some(name => hasBehavior(object, name)))

const maxHealth = object => (object.rawData[oInteractType] & INTERACT_BULLY) || hasBehavior(object, 'bhvChuckya')
    ? HEAVY_ENEMY_HEALTH : ENEMY_HEALTH

// Mario can draw from standing or walking, but not mid-slide, while knocked
// back, crawling, riding a shell or carrying something.
// `landed` ignores the off-floor input left over from the frame Mario touched down.
export const canStartAiming = (m, input = window.playerInput, landed = false) => {
    if (!input.buttonDownAim || m.action === ACT_GUN_AIM || m.heldObj || (!landed && (m.input & INPUT_OFF_FLOOR))) return false
    // Landing from an aimed jump stays a landing, so the next jump can chain.
    if (!landed && weaponState.airAim && landingActions().includes(m.action)) return false
    const group = m.action & ACT_GROUP_MASK
    if (group === ACT_GROUP_STATIONARY) return Boolean(m.action & ACT_FLAG_ALLOW_FIRST_PERSON)
    return group === ACT_GROUP_MOVING && !(m.action & (ACT_FLAG_INVULNERABLE | ACT_FLAG_SHORT_HITBOX
        | ACT_FLAG_RIDING_SHELL | ACT_FLAG_DIVING | ACT_FLAG_BUTT_OR_STOMACH_SLIDE))
}

const chest = m => [m.pos[0], m.pos[1] + 100, m.pos[2]]

const targetPosition = object => [object.rawData[oPosX],
    object.rawData[oPosY] - (object.hitboxDownOffset || 0) + (object.hitboxHeight || 100) / 2,
    object.rawData[oPosZ]]

const asTarget = object => {
    const gfx = object.gfx || {}
    const height = object.hitboxHeight || 100
    const down = object.hitboxDownOffset || 0
    if (object.weaponHealth === undefined) object.weaponHealth = maxHealth(object)
    return {
        object,
        pos: targetPosition(object),
        top: object.rawData[oPosY] - down + height,
        visible: Boolean(gfx.flags & GRAPH_RENDER_ACTIVE) && !(gfx.flags & GRAPH_RENDER_INVISIBLE),
        health: object.weaponHealth / maxHealth(object),
    }
}

export const collectEnemies = lists => {
    const targets = []
    for (const index of ENEMY_LISTS) {
        const head = lists[index]
        for (let object = head.next; object && object !== head; object = object.next) {
            // Enemies that shrug off the final blow (a Bully just gets pushed back)
            // become targets again with full health.
            if (object.weaponDefeated && (object.activeFlags & 1) && --object.weaponRecover <= 0) {
                object.weaponDefeated = false
                object.weaponHealth = maxHealth(object)
            }
            if (isEnemy(object)) targets.push(asTarget(object))
        }
    }
    return targets
}

// Health runs out → finish the enemy the SM64 way: Bob-ombs blow up and
// everything else takes a kick, which its own behavior handles (Goombas are
// knocked into the air and defeated, Bullies are pushed back).
const RECOVER_FRAMES = 90
export const damageEnemy = (object, damage) => {
    if (object.weaponHealth === undefined) object.weaponHealth = maxHealth(object)
    object.weaponHealth = Math.max(0, object.weaponHealth - damage)
    if (object.weaponHealth > 0 || object.weaponDefeated) return false
    object.weaponDefeated = true
    object.weaponRecover = RECOVER_FRAMES
    if (hasBehavior(object, 'bhvBobomb')) object.rawData[oAction] = BOBOMB_ACT_EXPLODE
    else object.rawData[oInteractStatus] = ATTACK_KICK_OR_TRIP | INT_STATUS_INTERACTED | INT_STATUS_WAS_ATTACKED
    return true
}

// The direction the camera looks, which is where GTA searches for a target.
const cameraYaw = camera => Targeting.yawTo(camera.pos, camera.focus)

// GTA checks neck to neck (LOSBlockedBetweenPeds), so a low lip of ground
// between Mario and a short enemy doesn't hide it: use head heights here.
const losBlocked = (shooter, target) => Targeting.lineOfSightBlocked(gLinker.SurfaceCollision,
    [shooter.pos[0], shooter.pos[1] + 20, shooter.pos[2]], [target.pos[0], target.top, target.pos[2]])

const yawOf = v => Math.round(Math.atan2(v[0], v[2]) / Math.PI * 0x8000)

// Runs once per frame while Mario aims. Picks or keeps a lock, handles
// C-left / C-right target switching and the trigger (B), and returns the yaw
// to face. `facing` is where the gun points, for shots without a lock.
// Mid-jump `body` is Mario's torso (torsoInWorld): when a flip leaves the lock
// somewhere his arms can't point, he aims and fires straight ahead of his chest.
export const updateWeaponAim = (m, input = window.playerInput, facing = m.faceAngle[1], body = null) => {
    const state = weaponState
    const weapon = currentWeapon()
    const shooter = { pos: chest(m) }
    const lakitu = gLinker.Camera.gLakituState
    const candidates = collectEnemies(gLinker.ObjectListProcessor.gObjectLists)
    let target = state.target && candidates.find(c => c.object === state.target.object)
    if (target && Targeting.targetHasToBeBroken(shooter, target, weapon)) target = null
    if (!target) target = Targeting.findLockOnTarget(shooter, candidates, weapon, cameraYaw(lakitu), losBlocked)
    if (target && (input.buttonPressedCl || input.buttonPressedCr)) {
        target = Targeting.findNextLockOnTarget(shooter, target, candidates, weapon,
            Boolean(input.buttonPressedCl), losBlocked) || target
    }
    // Target switching owns the C-left / C-right press, not the camera.
    input.buttonPressedCl = input.buttonPressedCr = false
    state.target = target
    // Where the arms point the gun: at the lock if they can, else straight ahead.
    const lock = target && (!body || canPointAt(body, target.pos)) ? target : null
    const aimYaw = target ? Targeting.yawTo(m.pos, target.pos) : cameraYaw(lakitu)
    state.aimTarget = lock ? lock.object : null
    state.aimYaw = aimYaw
    state.aimPoint = lock ? [...lock.pos] : null
    state.aimDir = body ? body.forward : [Math.sin(aimYaw / 0x8000 * Math.PI), 0, Math.cos(aimYaw / 0x8000 * Math.PI)]

    if (state.flash > 0) state.flash--
    const ammo = state.ammo[state.index]
    const wasReloading = ammo.reload > 0
    const fired = pullTrigger(ammo, weapon, input.buttonPressedB, input.buttonDownB)
    // Single-shot guns pump or work the bolt in their own shot sound.
    if (weapon.clip > 1 && wasReloading && ammo.reload === 0) play_gun_sound('ready')
    if (weapon.clip > 1 && !wasReloading && ammo.reload > 0) play_gun_sound('reload')
    if (!fired && wasReloading && input.buttonPressedB) play_gun_sound('empty')
    if (fired) {
        state.flash = 2
        play_gun_sound(weapon.id)
        // A shot straight ahead mid-flip goes where his chest faces, and one
        // into the sky or the ground hits nothing.
        const level = lock || !body || Math.abs(body.forward[1]) < Math.SQRT1_2
        const shotYaw = lock || !body ? aimYaw : yawOf(body.forward)
        for (const hit of level ? shotHits(shooter, shotYaw, lock, candidates, weapon, losBlocked) : []) {
            damageEnemy(hit.target.object, hit.damage)
            hit.target.health = hit.target.object.weaponHealth / maxHealth(hit.target.object)
        }
        // A defeated enemy is finished; the next frame locks on to someone else.
        if (target && target.object.weaponDefeated) state.target = null
    }
    return aimYaw
}

export const stopWeaponAim = () => {
    weaponState.target = null
    weaponState.aimTarget = null
    weaponState.flash = 0
}

// A jump from the aim stance: the body keeps facing the target while the jump
// takes Mario wherever it goes.
export const startJumpAim = m => {
    weaponState.airAim = true
    weaponState.airYaw = weaponState.airAimYaw = m.faceAngle[1]
    weaponState.airGfx = null
}

// Before Mario's action runs: B is the trigger while aiming in the air, so it
// mustn't also jump kick or dive.
export const beginAirAim = (m, input = window.playerInput) => {
    if (canAimInAir(m, input)) m.input &= ~INPUT_B_PRESSED
}

// In the air the jump animation plays as normal; only the arms hold the gun.
const airPoseSources = new Map()
const pinAirPose = m => {
    const info = m.marioObj.gfx.animInfo
    if (!info.curAnim || airPoseSources.has(info.curAnim)) return
    const pose = rigArms(info.curAnim)
    airPoseSources.set(pose, info.curAnim)
    info.curAnim = pose
}
const unpinAirPose = m => {
    const info = m.marioObj.gfx.animInfo
    if (airPoseSources.has(info.curAnim)) info.curAnim = airPoseSources.get(info.curAnim)
}

// After Mario's action runs: while he jumps or falls with the aim button held,
// turn his body (not his momentum) to the target, hold the gun out and handle
// the trigger. Landing with the button still held goes straight back to
// aiming on the ground.
export const updateAirAim = (m, setAction, input = window.playerInput) => {
    const wasAiming = weaponState.airAim
    weaponState.airAim = canAimInAir(m, input)
    if (!weaponState.airAim) {
        if (!wasAiming) return
        unpinAirPose(m)
        if (canStartAiming(m, input, true)) {
            m.faceAngle[1] = weaponState.airYaw
            setAction(m, ACT_GUN_AIM, 0)
        } else if (m.action !== ACT_GUN_AIM) {
            stopWeaponAim()
        }
        return
    }
    const state = weaponState
    if (!wasAiming) startJumpAim(m)
    const turn = int16(Math.round(state.airAimYaw) - state.airYaw)
    state.airYaw = int16(state.airYaw + Math.max(-0x1800, Math.min(0x1800, turn)))
    // Turn the body to the target on top of the facing the jump gives it (a
    // side flip faces backwards), unless the action left our last yaw in place.
    const gfx = m.marioObj.gfx
    const actionYaw = state.airGfx && gfx.angle[1] === state.airGfx.drawn ? state.airGfx.action : gfx.angle[1]
    gfx.angle[1] = int16(actionYaw + state.airYaw - m.faceAngle[1])
    state.airGfx = { action: actionYaw, drawn: gfx.angle[1] }
    pinAirPose(m)
    const info = gfx.animInfo
    const body = torsoInWorld(info.curAnim, info.animFrame, m.pos, gfx.angle)
    state.airAimYaw = updateWeaponAim(m, input, state.airYaw, body)
}

// Express a camera-space point or direction in the space of a rendered part.
const intoPart = (part, v, isPoint) => {
    const p = isPoint ? [v[0] - part[3][0], v[1] - part[3][1], v[2] - part[3][2]] : v
    return [0, 1, 2].map(i => (p[0] * part[i][0] + p[1] * part[i][1] + p[2] * part[i][2])
        / (part[i][0] ** 2 + part[i][1] ** 2 + part[i][2] ** 2))
}
const intoCamera = (camera, v, isPoint) => [0, 1, 2].map(j =>
    v[0] * camera[0][j] + v[1] * camera[1][j] + v[2] * camera[2][j] + (isPoint ? camera[3][j] : 0))

// Mario's torso geo calls this before drawing his arms. When he's playing an
// aiming animation, solve the gun arm against the torso as it's being drawn.
export const geo_mario_aim_arms = (callContext, node, torso) => {
    const renderer = gLinker.GeoRenderer
    const rig = renderer && rigForValues(renderer.gCurAnimData)
    const camera = rig && renderer.gCurGraphNodeCamera && renderer.gCurGraphNodeCamera.matrixPtr
    if (!camera || !torso) return null
    const state = weaponState
    const toTorso = (v, isPoint) => intoPart(torso, intoCamera(camera, v, isPoint), isPoint)
    const aim = {
        // The render follows live positions, including the frame of a lethal shot.
        point: state.aimTarget ? toTorso(targetPosition(state.aimTarget), true) : state.aimPoint && toTorso(state.aimPoint, true),
        dir: toTorso(state.aimDir, false),
        up: toTorso([0, 1, 0], false),
        muzzleHeight: mario_gun_dls[currentWeapon().id].muzzle[1],
    }
    const foregrip = currentWeapon().foregrip
    const arms = foregrip ? solveTwoHanded(aim, foregrip) : { right: solveGunArm(aim).rotations, left: null }
    RIGHT_ARM.forEach((part, i) => writeRotation(rig, part, arms.right[i]))
    LEFT_ARM.forEach((part, i) => arms.left ? writeRotation(rig, part, arms.left[i]) : writeAnimated(rig, part, renderer.gCurrAnimFrame))
    return null
}

// Mario's right-hand geo calls this; the gun only appears while aiming.
export const geo_mario_gun = (callContext, node) => {
    node.flags = (LAYER_OPAQUE << 8) | (node.flags & 0xFF)
    if (!isAiming()) return null
    const model = mario_gun_dls[currentWeapon().id]
    return weaponState.flash > 0 ? model.flashDl : model.dl
}

let marker, panel

// Place an element at canvas pixel (x, y), allowing for the canvas's padding and scaling.
const placeOnCanvas = (element, canvas, x, y) => {
    const rect = canvas.getBoundingClientRect()
    const style = getComputedStyle(canvas)
    const left = rect.left + parseFloat(style.paddingLeft), top = rect.top + parseFloat(style.paddingTop)
    const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    element.style.left = `${left + x * width / canvas.width}px`
    element.style.top = `${top + y * height / canvas.height}px`
}

// GTA's CWeaponEffects::MarkTarget draws a health-tinted marker over the lock.
const updateTargetMarker = canvas => {
    const target = weaponState.target
    if (!marker) {
        marker = document.createElement('div')
        marker.id = 'weapon-target-marker'
        marker.style.cssText = 'position:fixed;z-index:1000;pointer-events:none;width:0;height:0;'
            + 'border-left:11px solid transparent;border-right:11px solid transparent;border-top:18px solid;'
            + 'transform:translate(-50%,-100%);filter:drop-shadow(0 0 2px #000)'
        document.body.appendChild(marker)
    }
    const camera = target && { ...gLinker.Camera.gLakituState, fov: gLinker.Camera.sFOVState.fov || 45 }
    const point = target && Targeting.projectToScreen(camera, [target.pos[0], target.top + 40, target.pos[2]],
        canvas.width, canvas.height)
    const onScreen = point && point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height
    marker.hidden = !onScreen
    if (!onScreen) return
    placeOnCanvas(marker, canvas, point.x, point.y)
    marker.style.borderTopColor = `rgb(${Targeting.markerColour(target.health).join(',')})`
}

// Weapon name and ammo, shown while aiming and briefly after switching.
const updateWeaponPanel = canvas => {
    if (!panel) {
        panel = document.createElement('div')
        panel.id = 'weapon-panel'
        panel.style.cssText = 'position:fixed;z-index:1000;pointer-events:none;transform:translateY(-100%);'
            + 'padding:6px 12px;border-radius:6px;background:rgba(15,20,30,.82);color:#fff;'
            + 'font:600 14px sans-serif;white-space:nowrap'
        document.body.appendChild(panel)
    }
    panel.hidden = !(isAiming() || weaponState.hudFrames > 0)
    if (panel.hidden) return
    const weapon = currentWeapon(), ammo = weaponState.ammo[weaponState.index]
    const text = `${weapon.name} · ${ammo.reload > 0 ? 'Reloading' : `${ammo.clip} / ${weapon.clip}`}`
    if (panel.textContent !== text) panel.textContent = text
    placeOnCanvas(panel, canvas, 12, canvas.height - 12)
}

// Called once per rendered frame: weapon switching (R / right bumper), the
// lock-on marker and the weapon panel.
export const updateWeaponHud = (input = window.playerInput) => {
    if (!isAiming()) weaponState.target = null
    if (input.buttonPressedNextWeapon) {
        weaponState.index = nextWeapon(weaponState.index)
        weaponState.flash = 0
        weaponState.hudFrames = 90
        play_gun_sound('switch')
    } else if (weaponState.hudFrames > 0) {
        weaponState.hudFrames--
    }
    const canvas = typeof document !== 'undefined' && document.getElementById('gameCanvas')
    if (!canvas) return
    updateTargetMarker(canvas)
    updateWeaponPanel(canvas)
}

gLinker.MarioWeapon = { geo_mario_gun, geo_mario_aim_arms, weaponState }
