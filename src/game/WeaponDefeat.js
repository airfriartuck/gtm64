import { ACTIVE_FLAG_DEACTIVATED, oPosX, oPosY, oPosZ, oIntangibleTimer, oInteractType,
    oInteractStatus, oFaceAnglePitch, oFaceAngleYaw, oFaceAngleRoll, oGraphYOffset,
    oAction, oPrevAction, oTimer, BULLY_ACT_LAVA_DEATH } from "../include/object_constants"
import { GRAPH_RENDER_HAS_ANIMATION } from "../engine/graph_node"

const NATIVE_DEATH_FRAMES = 30
const CORPSE_FRAMES = 120
const FALL_FRAMES = 12

const startKnockout = object => {
    const source = object.weaponShotFrom
    const dx = source ? object.rawData[oPosX] - source[0] : 0
    const dz = source ? object.rawData[oPosZ] - source[2] : 1
    const distance = Math.hypot(dx, dz) || 1
    object.weaponKnockout = { frames: 0, velocity: [dx * 12 / distance, 12, dz * 12 / distance],
        floor: object.rawData[oPosY], scale: [...(object.gfx.scale || [1, 1, 1])],
        yaw: Math.atan2(dx, dz) * 0x8000 / Math.PI }
    object.rawData[oInteractType] = 0
    object.rawData[oInteractStatus] = 0
    object.rawData[oIntangibleTimer] = -1
}

// Normal enemies keep their native kicked death; resistant enemies fall and
// remain defeated. Bob-ombs retain their own explosion behavior.
export const beginWeaponDefeat = (object, shooterPosition, resistant = false) => {
    object.weaponShotFrom = shooterPosition ? [...shooterPosition] : null
    object.weaponNativeDeathFrames = NATIVE_DEATH_FRAMES
    if (resistant) startKnockout(object)
}

// Called before an object's behavior. Returns true while the weapon owns its
// knockout motion, preventing a defeated enemy's AI from fighting Mario.
export const updateWeaponDefeat = (object, collision) => {
    if (!object.weaponDefeated || !(object.activeFlags & 1) || object.weaponExplodes) return false
    if (!object.weaponKnockout && --object.weaponNativeDeathFrames > 0) return false
    if (!object.weaponKnockout) startKnockout(object)
    const knockout = object.weaponKnockout
    const frame = ++knockout.frames
    object.rawData[oInteractStatus] = 0
    object.gfx.flags &= ~GRAPH_RENDER_HAS_ANIMATION
    if (frame <= 30 || knockout.velocity[1] !== 0) {
        const next = [oPosX, oPosY, oPosZ].map((field, axis) => object.rawData[field] + knockout.velocity[axis])
        const blocked = collision && collision.f32_find_wall_collision({ x: next[0], y: next[1] + 40, z: next[2] }, 0, 30)
        if (blocked) knockout.velocity[0] = knockout.velocity[2] = 0
        else {
            object.rawData[oPosX] = next[0]
            object.rawData[oPosZ] = next[2]
        }
        const floor = collision ? collision.find_floor(next[0], next[1] + 100, next[2], {}) : knockout.floor
        knockout.floor = floor > -10000 ? floor : knockout.floor
        object.rawData[oPosY] = Math.max(next[1], knockout.floor)
        knockout.velocity[1] = next[1] <= knockout.floor ? 0 : knockout.velocity[1] - 2
        knockout.velocity[0] *= 0.82
        knockout.velocity[2] *= 0.82
    }
    object.rawData[oFaceAngleYaw] = knockout.yaw
    object.rawData[oFaceAnglePitch] = -Math.min(1, frame / FALL_FRAMES) * 0x4000
    object.rawData[oFaceAngleRoll] = 0
    object.gfx.pos = [object.rawData[oPosX], object.rawData[oPosY] + (object.rawData[oGraphYOffset] || 0), object.rawData[oPosZ]]
    object.gfx.angle = [object.rawData[oFaceAnglePitch], knockout.yaw, 0]
    const scale = Math.min(1, (CORPSE_FRAMES - frame) / 15)
    object.gfx.scale = knockout.scale.map(value => value * Math.max(0, scale))
    if (frame >= CORPSE_FRAMES) {
        if (object.weaponBully) {
            // Let the native Bully cleanup award its coin, notify its minion
            // spawner and complete the level's existing death side effects.
            object.rawData[oAction] = object.rawData[oPrevAction] = BULLY_ACT_LAVA_DEATH
            object.rawData[oTimer] = 31
            return false
        }
        object.activeFlags = ACTIVE_FLAG_DEACTIVATED
    }
    return true
}
