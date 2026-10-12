// Mario getting into and out of the Mustang the way GTA San Andreas does it
// (gta-reversed: CTaskComplexEnterCar, CTaskSimpleCarAlign / GetIn / GetOut /
// JumpOut / WaitToSlowDown, CVehicle::CanPedStepOutCar / CanPedJumpOutCar).
//
// Entering a convertible with a closed driver's door, SA skips opening it:
// the ped walks to the door, lines up with the car and vaults straight in
// (CTaskComplexEnterCar::CreateNextSubTask_AfterSimpleCarAlign, convertible
// branch). Leaving, the ped steps out once the car has stopped, rolls out at
// moderate speed, and otherwise waits for the car to slow down.
// SM64 has no car animations, so Mario's own jump, sit and land animations
// play over each phase.

// Car-space offsets in SM64 units: +X is the driver's (left) side, +Z the nose.
export const DRIVER_SEAT = [38, 25, 0]
export const DRIVER_DOOR = [140, 0, 10]
export const SEATED_SCALE = 0.75

const WALK_SPEED = 14
export const ALIGN_FRAMES = 6
export const GET_IN_FRAMES = 24
export const GET_OUT_FRAMES = 22
export const JUMP_OUT_FRAMES = 6

// Mario animation IDs (MARIO_ANIM_*), kept local to avoid importing Mario.js.
export const ANIM = { WALKING: 0x48, IDLE: 0xC5, SINGLE_JUMP: 0x4D, LAND: 0x4E, SIT_DOWN: 0x84, DIVE: 0x88 }

const wrap = angle => ((angle + 32768) % 65536 + 65536) % 65536 - 32768
const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]) * 32768 / Math.PI
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => t * t * (3 - 2 * t)
const turnTowards = (yaw, target, rate) => wrap(yaw + Math.max(-rate, Math.min(rate, wrap(target - yaw))))

// A car-space point in the world, following the car's full orientation when
// its physics body exists (pitch and roll included).
export const carPoint = (car, local) => {
    const [x, y, z] = local
    if (car.body) {
        const { right, up, forward } = car.body
        // body.right is the car's right-hand side, i.e. car-space −X.
        return [0, 1, 2].map(i => [car.x, car.y, car.z][i] - right[i] * x + up[i] * y + forward[i] * z)
    }
    const yaw = (car.yaw || 0) * Math.PI / 32768, s = Math.sin(yaw), c = Math.cos(yaw)
    return [car.x + x * c + z * s, car.y + y, car.z - x * s + z * c]
}

// CVehicle::CanPedStepOutCar / CanPedJumpOutCar, with GTA's horizontal plane
// being SM64's x/z. Speeds are in metres per 1/50 s, as in the physics body.
export const exitMode = car => {
    const body = car.body
    if (!body) return 'step'
    const [vx, vy, vz] = body.moveSpeed
    const horizontal = vx * vx + vz * vz
    const turn = body.turnSpeed.reduce((sum, v) => sum + v * v, 0)
    if (horizontal <= 0.01 * 0.01 && Math.abs(vy) <= 0.05 && turn <= 0.0004) return 'step'
    if (horizontal >= 0.1 && horizontal <= 0.5) return 'jump'
    return 'wait'
}

export const beginEnter = (marioPos, marioYaw) => ({ kind: 'enter', phase: 'approach', frame: 0, pos: [...marioPos], yaw: marioYaw })

// Car-space position of a world point (inverse of carPoint, ignoring tilt).
const toCarSpace = (car, point) => {
    const yaw = (car.yaw || 0) * Math.PI / 32768, s = Math.sin(yaw), c = Math.cos(yaw)
    const dx = point[0] - car.x, dz = point[2] - car.z
    return [dx * c - dz * s, 0, dx * s + dz * c]
}

// Like GTA's route to a car door, walk round the nearer end of the car rather
// than through it when starting on the far side.
const CAR_HALF_LENGTH = 300, CAR_SIDE = 140
const approachWaypoints = (car, from) => {
    const [x, , z] = toCarSpace(car, from)
    if (x >= CAR_SIDE * 0.5) return []
    const end = z >= 0 ? CAR_HALF_LENGTH : -CAR_HALF_LENGTH
    // Beyond the nose or tail only the driver-side corner is needed; alongside
    // the passenger side, go via both corners of the nearer end.
    return Math.abs(z) < CAR_HALF_LENGTH ? [[-CAR_SIDE, 0, end], [CAR_SIDE, 0, end]] : [[CAR_SIDE, 0, end]]
}
export const beginExit = (mode, exitPos) => ({ kind: mode === 'jump' ? 'jump' : 'exit', phase: mode === 'jump' ? 'jumpout' : 'getout', frame: 0, to: exitPos && [...exitPos] })

// Mario's pose while seated, for the driving frames between sequences.
export const seatedPose = car => ({
    pos: carPoint(car, DRIVER_SEAT), angle: [car.pitch || 0, car.yaw || 0, car.roll || 0],
    anim: { id: ANIM.SIT_DOWN, frame: 'end' }, scale: SEATED_SCALE,
})

// Advance a sequence one frame. groundAt(x, z, nearY) returns floor height.
// Returns Mario's pose: { pos, angle: [pitch, yaw, roll], anim: { id, frame | progress | speed }, scale, done }.
export const stepSequence = (seq, car, groundAt) => {
    const carYaw = car.yaw || 0
    const seat = carPoint(car, DRIVER_SEAT)
    const door = carPoint(car, DRIVER_DOOR)
    door[1] = groundAt(door[0], door[2], car.y)
    seq.frame++
    if (seq.phase === 'approach') {
        // TASK_COMPLEX_GO_TO_CAR_DOOR_AND_STAND_STILL
        if (!seq.waypoints) seq.waypoints = approachWaypoints(car, seq.pos)
        const target = seq.waypoints.length ? carPoint(car, seq.waypoints[0]) : door
        const dx = target[0] - seq.pos[0], dz = target[2] - seq.pos[2]
        const distance = Math.hypot(dx, dz)
        if (distance <= WALK_SPEED && seq.waypoints.length) {
            seq.waypoints.shift()
        } else if (distance <= WALK_SPEED || seq.frame > 150) {
            seq.pos = door
            seq.phase = 'align'
            seq.frame = 0
        } else {
            seq.pos = [seq.pos[0] + dx / distance * WALK_SPEED, 0, seq.pos[2] + dz / distance * WALK_SPEED]
            seq.pos[1] = groundAt(seq.pos[0], seq.pos[2], door[1])
            seq.yaw = turnTowards(seq.yaw, yawTo(seq.pos, target), 0x1800)
        }
        return { pos: [...seq.pos], angle: [0, seq.yaw, 0], anim: { id: ANIM.WALKING, speed: WALK_SPEED / 4 }, scale: 1 }
    }
    if (seq.phase === 'align') {
        // TASK_SIMPLE_CAR_ALIGN: turn to face the seat across the door.
        seq.pos = door
        seq.yaw = turnTowards(seq.yaw, yawTo(door, seat), 0x2000)
        if (seq.frame >= ALIGN_FRAMES) {
            seq.phase = 'getin'
            seq.frame = 0
        }
        return { pos: [...door], angle: [0, seq.yaw, 0], anim: { id: ANIM.IDLE, frame: 0 }, scale: 1 }
    }
    if (seq.phase === 'getin') {
        // TASK_SIMPLE_CAR_GET_IN, convertible: hop over the door and sit.
        const t = Math.min(seq.frame / GET_IN_FRAMES, 1)
        const k = ease(t)
        const pos = [lerp(door[0], seat[0], k), lerp(door[1], seat[1], k) + Math.sin(Math.PI * t) * 80, lerp(door[2], seat[2], k)]
        const yaw = lerp(seq.yaw, seq.yaw + wrap(carYaw - seq.yaw), ease(Math.min(t * 1.5, 1)))
        const sitting = t > 0.6
        return {
            pos, angle: [lerp(0, car.pitch || 0, k), yaw, lerp(0, car.roll || 0, k)],
            anim: sitting ? { id: ANIM.SIT_DOWN, progress: (t - 0.6) / 0.4 } : { id: ANIM.SINGLE_JUMP, progress: t / 0.6 },
            scale: lerp(1, SEATED_SCALE, k), done: t >= 1,
        }
    }
    if (seq.phase === 'getout') {
        // TASK_SIMPLE_CAR_GET_OUT: stand, swing out over the door and land.
        const t = Math.min(seq.frame / GET_OUT_FRAMES, 1)
        const k = ease(t)
        const to = seq.to || door
        const outward = wrap(carYaw + 0x4000)
        const pos = [lerp(seat[0], to[0], k), lerp(seat[1], to[1], k) + Math.sin(Math.PI * t) * 80, lerp(seat[2], to[2], k)]
        const landing = t > 0.75
        return {
            pos, angle: [lerp(car.pitch || 0, 0, k), lerp(carYaw, carYaw + wrap(outward - carYaw), ease(Math.min(t * 2, 1))), lerp(car.roll || 0, 0, k)],
            anim: landing ? { id: ANIM.LAND, progress: (t - 0.75) / 0.25 } : { id: ANIM.SINGLE_JUMP, progress: t / 0.75 },
            scale: lerp(SEATED_SCALE, 1, k), done: t >= 1,
        }
    }
    // TASK_SIMPLE_CAR_JUMP_OUT: lean out of the driver's side before the dive.
    const t = Math.min(seq.frame / JUMP_OUT_FRAMES, 1)
    const out = carPoint(car, [DRIVER_SEAT[0] + 60 * t, DRIVER_SEAT[1] + 40 * t, DRIVER_SEAT[2]])
    return {
        pos: out, angle: [0, carYaw + 0x2000 * t, 0], anim: { id: ANIM.DIVE, progress: t * 0.3 },
        scale: lerp(SEATED_SCALE, 1, t), done: t >= 1,
    }
}
