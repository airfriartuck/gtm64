// Weapon lock-on targeting with GTA-style reach, line-of-sight and target
// switching checks, adapted to choose Mario's nearest eligible enemy.
// Angles here are SM64 yaw units: 0x10000 per turn, 0 faces +Z.

// GTA works in metres; Mario is ~160 units tall, so 100 units ≈ 1 m.
export const UNITS_PER_METRE = 100
// Acquire enemies in front of the aim direction; a held lock can keep tracking
// one that moves behind Mario until it is otherwise no longer reachable.
export const MAX_TARGET_VIEW_ANGLE = 90
// CanIKReachThisTarget: Mario can't bend his arm further up or down than this.
export const MAX_AIM_PITCH = 60

const toDegrees = units => units * 360 / 0x10000
const wrapDegrees = degrees => ((degrees + 180) % 360 + 360) % 360 - 180

export const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]) * 0x8000 / Math.PI

// Signed angle in degrees, positive when the target is to the shooter's left.
export const angleOffAim = (from, to, aimYaw) => wrapDegrees(toDegrees(yawTo(from, to) - aimYaw))

const targetDistance = (shooter, target) => Math.hypot(...target.pos.map((value, axis) => value - shooter.pos[axis]))
const inAimCone = angle => Math.abs(angle) < MAX_TARGET_VIEW_ANGLE

// DoesTargetHaveToBeBroken: the lock is dropped when the target vanishes, moves
// out of weapon range, or sits where Mario's arm (GTA: IK chain) can't point.
export const targetHasToBeBroken = (shooter, target, weapon) => {
    if (!target.visible) return true
    const dx = target.pos[0] - shooter.pos[0], dz = target.pos[2] - shooter.pos[2]
    const dy = target.pos[1] - shooter.pos[1]
    const horizontal = Math.hypot(dx, dz)
    if (Math.hypot(horizontal, dy) > weapon.range) return true
    const pitch = Math.atan2(Math.abs(dy), horizontal) * 180 / Math.PI
    return pitch > MAX_AIM_PITCH && Math.abs(dy) > 50
}

// Distance determines the initial lock. View angle only breaks equal-distance
// ties, so an enemy beside the crosshair cannot lose to a farther enemy ahead.
export const evaluateTarget = (shooter, target, best, weapon, aimYaw, losBlocked) => {
    if (targetHasToBeBroken(shooter, target, weapon)) return
    const angle = Math.abs(angleOffAim(shooter.pos, target.pos, aimYaw))
    const distance = targetDistance(shooter, target)
    if (!inAimCone(angle) || distance > best.distance
        || (distance === best.distance && angle >= best.angle)) return
    if (!losBlocked(shooter, target)) {
        best.target = target
        best.distance = distance
        best.angle = angle
    }
}

export const findLockOnTarget = (shooter, candidates, weapon, aimYaw, losBlocked) => {
    const best = { target: null, distance: Infinity, angle: Infinity }
    for (const target of candidates) evaluateTarget(shooter, target, best, weapon, aimYaw, losBlocked)
    return best.target
}

// EvaluateNeighbouringTarget: pick the target nearest in angle on the requested
// side of the current one, so flicking left/right steps through enemies in order.
export const findNextLockOnTarget = (shooter, current, candidates, weapon, toLeft, losBlocked) => {
    const currentYaw = yawTo(shooter.pos, current.pos)
    let next = null, closestAngle = Infinity, closestDistance = Infinity
    for (const target of candidates) {
        if (target === current) continue
        if (targetHasToBeBroken(shooter, target, weapon)) continue
        const angle = angleOffAim(shooter.pos, target.pos, currentYaw)
        if (!inAimCone(angle) || (toLeft ? angle <= 0 : angle >= 0)) continue
        const offset = Math.abs(angle), distance = targetDistance(shooter, target)
        if ((offset < closestAngle || (offset === closestAngle && distance < closestDistance))
            && !losBlocked(shooter, target)) {
            next = target
            closestAngle = offset
            closestDistance = distance
        }
    }
    return next
}

// LOSBlockedBetweenPeds, using SM64 collision instead of CWorld::ProcessLineOfSight.
// SM64 has no ray query, so march from chest to chest checking for walls and
// for terrain rising above the line (a hill or ledge between Mario and the enemy).
// Steps are twice the wall probe radius so a thin wall can't slip between them.
const LOS_WALL_RADIUS = 10
export const lineOfSightBlocked = (collision, from, to) => {
    const delta = to.map((v, i) => v - from[i])
    const length = Math.hypot(...delta)
    const steps = Math.ceil(length / (LOS_WALL_RADIUS * 2))
    for (let step = 1; step < steps; step++) {
        const t = step / steps
        const [x, y, z] = from.map((v, i) => v + delta[i] * t)
        const floor = collision.find_floor(x, y + 100, z, {})
        if (floor > y && floor <= y + 100) return true
        if (collision.f32_find_wall_collision({ x, y, z }, 0, LOS_WALL_RADIUS)) return true
    }
    return false
}

// GTA tints the lock-on marker from green (full health) to red (nearly dead).
export const markerColour = healthFraction => {
    const f = Math.max(0, Math.min(1, healthFraction))
    return [Math.round((1 - f) * 255), Math.round(f * 255), 0]
}

// Project a world point onto the canvas the way guPerspective + mtxf_lookat do,
// so the HTML marker sits on the enemy. Returns null when behind the camera.
export const projectToScreen = (camera, point, width, height) => {
    const forward = camera.focus.map((v, i) => v - camera.pos[i])
    const fLength = Math.hypot(...forward)
    const f = forward.map(v => v / fLength)
    // right = forward × up, then the true up = right × forward.
    let right = [-f[2], 0, f[0]]
    const rLength = Math.hypot(...right) || 1
    right = right.map(v => v / rLength)
    const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]]
    const rel = point.map((v, i) => v - camera.pos[i])
    const depth = rel[0] * f[0] + rel[1] * f[1] + rel[2] * f[2]
    if (depth <= 1) return null
    const scale = 1 / Math.tan(camera.fov * Math.PI / 360)
    const aspect = width / height
    const sx = (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) * scale / aspect / depth
    const sy = (rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) * scale / depth
    return { x: (sx + 1) / 2 * width, y: (1 - sy) / 2 * height, depth }
}
