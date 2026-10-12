// Mario's arms while he holds a gun. Animations can't know where the target
// is, so the arm channels of an aiming animation are redirected to slots that
// a geo callback fills each frame: it reads the torso's render matrix, then
// solves shoulder → elbow → wrist so the barrel points at the target with the
// gun kept upright, whatever pose the rest of the body is in.
//
import { Mat4, mtxf_rotate_zxy_and_translate, mtxf_rotate_xyz_and_translate, mtxf_mul, mtxf_scale_vec3f } from "../engine/math_util"

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
        rig.values[rig.rig.slots[part] + axis] = source.values[source.indices[index + 1]
            + Math.max(0, Math.min(frame, source.indices[index] - 1))]
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

// Where the left hand can reach along a barrel running from `wrist` along
// `aim`: the furthest point up to `grip` that's within `reach` of the left
// shoulder, or null when it can't get ahead of the right wrist. In the
// squared-up stance it reaches the front of the receiver; mid-jump the body
// can be turned so far that both hands end up on the grip.
const MIN_GRIP = 30
const leftGripDistance = (wrist, aim, up, [grip, under], reach) => {
    const q = sub(add(wrist, up, under), SHOULDER_L)
    const b = dot(q, aim), disc = b * b - dot(q, q) + reach * reach
    if (disc < 0) return null
    const far = Math.min(grip, -b + Math.sqrt(disc))
    return far >= MIN_GRIP && far >= -b - Math.sqrt(disc) ? far : null
}

// Right-wrist placements to try, in the aim frame (forward, left, up), from a
// hand held out in front of the right shoulder to one tucked across the chest.
const RIFLE_WRISTS = []
for (let left = -40; left <= 160; left += 10) {
    for (let forward = 110; forward >= -20; forward -= 10) for (const up of [10, -10, -30, -50]) RIFLE_WRISTS.push([forward, left, up])
}

// A two-handed gun: the right hand holds the grip and the left reaches along
// the barrel toward `foregrip` ([distance from the right wrist, height]).
// Falls back to one hand when the left can't reach (left is null).
export const solveTwoHanded = ({ point, dir, up }, foregrip) => {
    let aim = point ? norm(sub(point, SHOULDER_R)) : norm(dir)
    const gunUp = frame(aim, up)[1], left = cross(gunUp, aim)
    let best = null
    for (const [f, l, u] of RIFLE_WRISTS) {
        const wrist = add(add(add(SHOULDER_R, aim, f), left, l), gunUp, u)
        if (Math.hypot(...sub(wrist, SHOULDER_R)) > REACH - 4) continue
        const grip = leftGripDistance(wrist, aim, gunUp, foregrip, REACH - 4)
        // Reach as far up the barrel as possible, keeping the hand near the shoulder.
        const score = grip === null ? -Infinity : grip - Math.abs(l) * 0.15
        if (!best || score > best.score) best = { score, wrist }
    }
    if (!best || best.score === -Infinity) return { right: solveGunArm({ point, dir, up }).rotations, left: null }
    if (point) aim = norm(sub(point, best.wrist))
    const hand = frame(aim, up)
    const right = solveArm(SHOULDER_R, best.wrist, [-1, 0, -0.5], hand)
    const grip = leftGripDistance(right.wrist, aim, hand[1], foregrip, REACH - 2)
    if (grip === null) return { right: solveGunArm({ point, dir, up }).rotations, left: null }
    const leftWrist = add(add(right.wrist, aim, grip), hand[1], foregrip[1])
    return { right: right.rotations, left: solveArm(SHOULDER_L, leftWrist, [-1, 0, 0.5], hand).rotations }
}

// Where Mario's torso is in the world for an animation frame, as the renderer
// would draw it (the object transform, the geo's 0.25 scale, then the root,
// hips and torso): which way his chest faces and where his gun shoulder is.
const BODY = [[0, 0, 0], [0, 0, 0], [68, 0, 0]]
export const torsoInWorld = (anim, frame, pos, angle) => {
    // Animations can start at frame -1 (SM64 steps them before drawing).
    const at = Math.max(0, frame)
    const read = ch => {
        const v = anim.values[anim.indices[ch * 2 + 1] + Math.min(at, anim.indices[ch * 2] - 1)]
        return v > 32767 ? v - 65536 : v
    }
    const object = Mat4()
    let matrix = Mat4()
    mtxf_rotate_zxy_and_translate(object, pos, angle)
    mtxf_scale_vec3f(matrix, object, [0.25, 0.25, 0.25])
    BODY.forEach((offset, part) => {
        const local = Mat4(), out = Mat4()
        const t = part === 0 ? [read(0), read(1), read(2)] : offset
        mtxf_rotate_xyz_and_translate(local, t, [0, 1, 2].map(axis => read(3 + part * 3 + axis)))
        mtxf_mul(out, local, matrix)
        matrix = out
    })
    const shoulder = [0, 1, 2].map(j => SHOULDER_R[0] * matrix[0][j] + SHOULDER_R[1] * matrix[1][j]
        + SHOULDER_R[2] * matrix[2][j] + matrix[3][j])
    return { up: norm(matrix[0].slice(0, 3)), forward: norm(matrix[1].slice(0, 3)), shoulder }
}

// Whether Mario's arms can point the gun at `point` from his body as it is:
// within 80° of where his chest faces.
const POINTABLE = Math.cos(80 * Math.PI / 180)
export const canPointAt = (body, point) => dot(norm(sub(point, body.shoulder)), body.forward) >= POINTABLE
