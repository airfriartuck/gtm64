import { oPosX, oPosY, oPosZ, oInteractType, oInteractStatus, oAction, BOBOMB_ACT_EXPLODE } from "../include/object_constants"
import { GRAPH_RENDER_ACTIVE, GRAPH_RENDER_INVISIBLE } from "../engine/graph_node"
import { LAYER_OPAQUE } from "../engine/GeoLayout"
import { INTERACT_BOUNCE_TOP, INTERACT_BOUNCE_TOP2, INTERACT_HIT_FROM_BELOW, INTERACT_KOOPA,
    INTERACT_BULLY, INTERACT_MR_BLIZZARD, ATTACK_KICK_OR_TRIP, INT_STATUS_INTERACTED, INT_STATUS_WAS_ATTACKED } from "./Interaction"
import { mario_gun_dls } from "../actors/mario_gun/model.inc"
import { ACT_GUN_AIM, ACT_GROUP_MASK, ACT_GROUP_STATIONARY, ACT_GROUP_MOVING, ACT_FLAG_ALLOW_FIRST_PERSON,
    ACT_FLAG_INVULNERABLE, ACT_FLAG_SHORT_HITBOX, ACT_FLAG_RIDING_SHELL, ACT_FLAG_DIVING,
    ACT_FLAG_BUTT_OR_STOMACH_SLIDE, INPUT_OFF_FLOOR, INPUT_B_PRESSED, ACT_JUMP, ACT_DOUBLE_JUMP, ACT_FREEFALL,
    ACT_LONG_JUMP, ACT_WALL_KICK_AIR, MARIO_ANIM_FIRST_PUNCH } from "./Mario"
import { pinParts, AIR_AIM_PARTS, AIM_FRAME } from "./MarioAimAnimation"
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

export const weaponState = { index: 0, ammo: newAmmo(), target: null, flash: 0, hudFrames: 0, airAim: false, airYaw: 0 }
export const currentWeapon = () => WEAPONS[weaponState.index]

// Ordinary jumps and falls keep their SM64 physics while Mario aims. Flips
// and the triple jump spin him too much to hold a gun steady. Read on use:
// Mario.js isn't initialised when this module loads.
const airAimActions = () => [ACT_JUMP, ACT_DOUBLE_JUMP, ACT_FREEFALL, ACT_LONG_JUMP, ACT_WALL_KICK_AIR]
export const canAimInAir = (m, input = window.playerInput) =>
    Boolean(input.buttonDownAim) && !m.heldObj && airAimActions().includes(m.action)

// Derived from Mario's action so knockbacks and warps put the gun away too.
export const isAiming = () => {
    const m = gLinker.LevelUpdate && gLinker.LevelUpdate.gMarioState
    return Boolean(m && (m.action === ACT_GUN_AIM || (weaponState.airAim && airAimActions().includes(m.action))))
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
    const group = m.action & ACT_GROUP_MASK
    if (group === ACT_GROUP_STATIONARY) return Boolean(m.action & ACT_FLAG_ALLOW_FIRST_PERSON)
    return group === ACT_GROUP_MOVING && !(m.action & (ACT_FLAG_INVULNERABLE | ACT_FLAG_SHORT_HITBOX
        | ACT_FLAG_RIDING_SHELL | ACT_FLAG_DIVING | ACT_FLAG_BUTT_OR_STOMACH_SLIDE))
}

const chest = m => [m.pos[0], m.pos[1] + 100, m.pos[2]]

const asTarget = object => {
    const gfx = object.gfx || {}
    const height = object.hitboxHeight || 100
    const down = object.hitboxDownOffset || 0
    if (object.weaponHealth === undefined) object.weaponHealth = maxHealth(object)
    return {
        object,
        pos: [object.rawData[oPosX], object.rawData[oPosY] - down + height / 2, object.rawData[oPosZ]],
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

// Runs once per frame while Mario aims. Picks or keeps a lock, handles
// C-left / C-right target switching and the trigger (B), and returns the yaw
// to face. `facing` is where the gun points, for shots without a lock.
export const updateWeaponAim = (m, input = window.playerInput, facing = m.faceAngle[1]) => {
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
        for (const hit of shotHits(shooter, facing, target, candidates, weapon, losBlocked)) {
            damageEnemy(hit.target.object, hit.damage)
            hit.target.health = hit.target.object.weaponHealth / maxHealth(hit.target.object)
        }
        // A defeated enemy is finished; the next frame locks on to someone else.
        if (target && target.object.weaponDefeated) state.target = null
    }
    return target ? Targeting.yawTo(m.pos, target.pos) : cameraYaw(lakitu)
}

export const stopWeaponAim = () => {
    weaponState.target = null
    weaponState.flash = 0
}

// Before Mario's action runs: B is the trigger while aiming in the air, so it
// mustn't also jump kick or dive.
export const beginAirAim = (m, input = window.playerInput) => {
    if (canAimInAir(m, input)) m.input &= ~INPUT_B_PRESSED
}

// Jump animations with the torso, head and gun arm pinned to the aiming pose.
const airPoses = new Map(), airPoseSources = new Map()
const pinAirPose = m => {
    const info = m.marioObj.gfx.animInfo
    if (!info.curAnim || airPoseSources.has(info.curAnim)) return
    let pose = airPoses.get(info.curAnim)
    if (!pose) {
        pose = pinParts(info.curAnim, m.animation.animList[MARIO_ANIM_FIRST_PUNCH], AIM_FRAME, AIR_AIM_PARTS)
        airPoses.set(info.curAnim, pose)
        airPoseSources.set(pose, info.curAnim)
    }
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
    if (!wasAiming) weaponState.airYaw = m.faceAngle[1]
    const aimYaw = updateWeaponAim(m, input, weaponState.airYaw)
    const turn = int16(Math.round(aimYaw) - weaponState.airYaw)
    weaponState.airYaw = int16(weaponState.airYaw + Math.max(-0x1800, Math.min(0x1800, turn)))
    m.marioObj.gfx.angle[1] = weaponState.airYaw
    pinAirPose(m)
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

gLinker.MarioWeapon = { geo_mario_gun, weaponState }
