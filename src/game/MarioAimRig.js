// Mario's arms while he holds a gun. Animations can't know where the target
// is, so the arm channels of an aiming animation are redirected to slots that
// a geo callback fills each frame: it reads the torso's render matrix, then
// solves shoulder → elbow → wrist so the barrel points at the target with the
// gun kept upright, whatever pose the rest of the body is in.
//
// All solving happens in torso space, in model units: x runs up the spine,
// y faces forward and z points to Mario's left.

// Animated parts: 4-7 left shoulder, arm, forearm, hand; 8-11 the right's.
export const LEFT_ARM = [4, 5, 6, 7], RIGHT_ARM = [8, 9, 10, 11]
export const SHOULDER_R = [68, -10, -79], SHOULDER_L = [67, -10, 79]
const UPPER_ARM = 65, FOREARM = 60
const REACH = UPPER_ARM + FOREARM - 1

const channel = (part, axis) => (3 + part * 3 + axis) * 2

// A copy of `anim` whose arm channels read from fixed slots (one frame each).
// `source` keeps the unredirected animation for arms the solver leaves alone.
const rigs = new WeakMap(), rigValues = new WeakMap()
export const rigArms = anim => {
    if (rigs.has(anim)) return rigs.get(anim)
    const values = [...anim.values], indices = [...anim.indices], slots = {}
    for (const part of [...LEFT_ARM, ...RIGHT_ARM]) {
        slots[part] = values.length
        for (let axis = 0; axis < 3; axis++) {
            const index = channel(part, axis)
            values.push(anim.values[anim.indices[index + 1] + Math.min(0, anim.indices[index] - 1)])
            indices[index] = 1
            indices[index + 1] = slots[part] + axis
        }
    }
    const rig = { ...anim, values, indices, rig: { slots, source: anim } }
    rigs.set(anim, rig)
    rigValues.set(values, rig)
    return rig
}
// The rig whose values the renderer is reading, if any.
export const rigForValues = values => rigValues.get(values) || null

const s16 = angle => Math.round(angle / Math.PI * 0x8000)
export const writeRotation = (rig, part, rotation) => {
    const at = rig.rig.slots[part]
    for (let axis = 0; axis < 3; axis++) rig.values[at + axis] = rotation[axis] & 0xFFFF
}
// Restore a part to its animated value at `frame`.
export const writeAnimated = (rig, part, frame) => {
    const source = rig.rig.source
    for (let axis = 0; axis < 3; axis++) {
        const index = channel(part, axis)
        rig.values[rig.rig.slots[part] + axis] = source.values[source.indices[index + 1] + Math.min(frame, source.indices[index] - 1)]
    }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const sub = (a, b) => add(a, b, -1)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
export const vec = { dot, add, sub, cross, norm }

// A rotation whose x axis is `x` and whose y axis leans toward `yHint`.
export const frame = (x, yHint) => {
    const X = norm(x)
    let Y = sub(yHint, X.map(v => v * dot(X, yHint)))
    if (Math.hypot(...Y) < 1e-4) {
        const other = Math.abs(X[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
        Y = sub(other, X.map(v => v * dot(X, other)))
    }
    Y = norm(Y)
    return [X, Y, cross(X, Y)]
}

// The XYZ Euler angles (SM64 units) that mtxf_rotate_xyz_and_translate turns
// into `child` when it sits under `parent` (both as rows in the same space).
export const eulerXYZ = (child, parent) => {
    const l = child.map(row => parent.map(axis => dot(row, axis)))
    const y = Math.asin(Math.max(-1, Math.min(1, -l[0][2])))
    return [s16(Math.atan2(l[1][2], l[2][2])), s16(y), s16(Math.atan2(l[0][1], l[0][0]))]
}

const TORSO = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

// Two-bone IK: rotations for shoulder, arm, forearm and hand putting the wrist
// at `wrist` (clamped to reach), the elbow bending toward `pole`, and the hand
// in `hand` orientation. Returns the rotations and where the wrist ended up.
export const solveArm = (shoulder, wrist, pole, hand) => {
    let toWrist = sub(wrist, shoulder)
    const d = Math.max(Math.abs(UPPER_ARM - FOREARM) + 1, Math.min(REACH, Math.hypot(...toWrist)))
    const u = norm(toWrist)
    const p = norm(sub(pole, u.map(v => v * dot(u, pole))))
    const cosA = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d)
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
    const elbow = add(shoulder, add(u.map(v => v * cosA), p, sinA), UPPER_ARM)
    const reached = add(shoulder, u, d)
    const upper = frame(sub(elbow, shoulder), pole.map(v => -v))
    const fore = frame(sub(reached, elbow), pole.map(v => -v))
    return {
        rotations: [eulerXYZ(upper, TORSO), [0, 0, 0], eulerXYZ(fore, upper), eulerXYZ(hand, fore)],
        wrist: add(elbow, fore[0], FOREARM),
    }
}

// The gun arm for a one-handed weapon: straight out from the shoulder toward
// the target point (or along `dir`), the gun upright against `up`.
export const solveGunArm = ({ point, dir, up }) => {
    const aim = point ? norm(sub(point, SHOULDER_R)) : norm(dir)
    const elbowDown = [-1, 0, -0.5]
    return solveArm(SHOULDER_R, add(SHOULDER_R, aim, REACH), elbowDown, frame(aim, up))
}
