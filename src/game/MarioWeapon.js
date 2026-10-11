import { oPosX, oPosY, oPosZ, oInteractType, oHealth } from "../include/object_constants"
import { GRAPH_RENDER_ACTIVE, GRAPH_RENDER_INVISIBLE } from "../engine/graph_node"
import { LAYER_OPAQUE } from "../engine/GeoLayout"
import { INTERACT_BOUNCE_TOP, INTERACT_BOUNCE_TOP2, INTERACT_HIT_FROM_BELOW, INTERACT_KOOPA,
    INTERACT_BULLY, INTERACT_MR_BLIZZARD } from "./Interaction"
import { mario_pistol_dl } from "../actors/mario_gun/model.inc"
import { ACT_GUN_AIM, ACT_GROUP_MASK, ACT_GROUP_STATIONARY, ACT_GROUP_MOVING, ACT_FLAG_ALLOW_FIRST_PERSON,
    ACT_FLAG_INVULNERABLE, ACT_FLAG_SHORT_HITBOX, ACT_FLAG_RIDING_SHELL, ACT_FLAG_DIVING,
    ACT_FLAG_BUTT_OR_STOMACH_SLIDE, INPUT_OFF_FLOOR } from "./Mario"
import * as Targeting from "./WeaponTargeting"

// Objects Mario can attack that also fight back. Hazards (flames, Amps) and
// passive objects are left out so the lock always lands on an enemy.
const ENEMY_INTERACTIONS = INTERACT_BOUNCE_TOP | INTERACT_BOUNCE_TOP2 | INTERACT_HIT_FROM_BELOW
    | INTERACT_KOOPA | INTERACT_BULLY | INTERACT_MR_BLIZZARD
// Bob-ombs and Chuckyas interact as grabbable objects, so name them directly.
const ENEMY_BEHAVIORS = ['bhvBobomb', 'bhvChuckya']
const ENEMY_LISTS = [2, 4, 5] // OBJ_LIST_DESTRUCTIVE, OBJ_LIST_GENACTOR, OBJ_LIST_PUSHABLE

// Colt 45 from GTA SA's weapon.dat: 35 m targeting range.
export const PISTOL = { name: 'Pistol', range: 35 * Targeting.UNITS_PER_METRE, dl: mario_pistol_dl }

export const weaponState = { weapon: PISTOL, target: null }

// Derived from Mario's action so knockbacks and warps put the gun away too.
export const isAiming = () => {
    const m = gLinker.LevelUpdate && gLinker.LevelUpdate.gMarioState
    return Boolean(m && m.action === ACT_GUN_AIM)
}

const isEnemy = object => Boolean(object.activeFlags & 1) && (Boolean(object.rawData[oInteractType] & ENEMY_INTERACTIONS)
    || ENEMY_BEHAVIORS.some(name => object.behavior && object.behavior === gLinker.behaviors[name]))

// Mario can draw from standing or walking, but not mid-slide, while knocked
// back, crawling, riding a shell or carrying something.
export const canStartAiming = (m, input = window.playerInput) => {
    if (!input.buttonDownAim || m.action === ACT_GUN_AIM || m.heldObj || (m.input & INPUT_OFF_FLOOR)) return false
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
    const health = object.rawData[oHealth]
    if (object.weaponMaxHealth === undefined || health > object.weaponMaxHealth) object.weaponMaxHealth = health || 0
    return {
        object,
        pos: [object.rawData[oPosX], object.rawData[oPosY] - down + height / 2, object.rawData[oPosZ]],
        top: object.rawData[oPosY] - down + height,
        visible: Boolean(gfx.flags & GRAPH_RENDER_ACTIVE) && !(gfx.flags & GRAPH_RENDER_INVISIBLE),
        health: object.weaponMaxHealth > 0 ? health / object.weaponMaxHealth : 1,
    }
}

export const collectEnemies = lists => {
    const targets = []
    for (const index of ENEMY_LISTS) {
        const head = lists[index]
        for (let object = head.next; object && object !== head; object = object.next) {
            if (isEnemy(object)) targets.push(asTarget(object))
        }
    }
    return targets
}

// The direction the camera looks, which is where GTA searches for a target.
const cameraYaw = camera => Targeting.yawTo(camera.pos, camera.focus)

// GTA checks neck to neck (LOSBlockedBetweenPeds), so a low lip of ground
// between Mario and a short enemy doesn't hide it: use head heights here.
const losBlocked = (shooter, target) => Targeting.lineOfSightBlocked(gLinker.SurfaceCollision,
    [shooter.pos[0], shooter.pos[1] + 20, shooter.pos[2]], [target.pos[0], target.top, target.pos[2]])

// Runs once per frame while Mario is in ACT_GUN_AIM. Picks or keeps a lock,
// handles C-left / C-right target switching and returns the yaw to face.
export const updateWeaponAim = (m, input = window.playerInput) => {
    const state = weaponState
    const shooter = { pos: chest(m) }
    const lakitu = gLinker.Camera.gLakituState
    const candidates = collectEnemies(gLinker.ObjectListProcessor.gObjectLists)
    let target = state.target && candidates.find(c => c.object === state.target.object)
    if (target && Targeting.targetHasToBeBroken(shooter, target, state.weapon)) target = null
    if (!target) target = Targeting.findLockOnTarget(shooter, candidates, state.weapon, cameraYaw(lakitu), losBlocked)
    if (target && (input.buttonPressedCl || input.buttonPressedCr)) {
        target = Targeting.findNextLockOnTarget(shooter, target, candidates, state.weapon,
            Boolean(input.buttonPressedCl), losBlocked) || target
    }
    // Target switching owns the C-left / C-right press, not the camera.
    input.buttonPressedCl = input.buttonPressedCr = false
    state.target = target
    return target ? Targeting.yawTo(m.pos, target.pos) : cameraYaw(lakitu)
}

export const stopWeaponAim = () => {
    weaponState.target = null
}

// Mario's right-hand geo calls this; the gun only appears while aiming.
export const geo_mario_gun = (callContext, node) => {
    node.flags = (LAYER_OPAQUE << 8) | (node.flags & 0xFF)
    return isAiming() ? weaponState.weapon.dl : null
}

// GTA's CWeaponEffects::MarkTarget draws a health-tinted marker over the lock.
// Called once per rendered frame.
let marker
export const updateTargetMarker = () => {
    if (!isAiming()) weaponState.target = null
    const target = weaponState.target
    const canvas = typeof document !== 'undefined' && document.getElementById('gameCanvas')
    if (!canvas) return
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
    const rect = canvas.getBoundingClientRect()
    const style = getComputedStyle(canvas)
    const left = rect.left + parseFloat(style.paddingLeft), top = rect.top + parseFloat(style.paddingTop)
    const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    marker.style.left = `${left + point.x * width / canvas.width}px`
    marker.style.top = `${top + point.y * height / canvas.height}px`
    marker.style.borderTopColor = `rgb(${Targeting.markerColour(target.health).join(',')})`
}

gLinker.MarioWeapon = { geo_mario_gun, weaponState }
