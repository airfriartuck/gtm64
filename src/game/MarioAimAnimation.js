// Strafing animations for aiming: Mario keeps the steady aiming pose above
// the waist while his legs walk or sidestep. SM64 animations have no per-bone
// blending, so build composite animations whose upper-body channels are pinned
// to the aiming pose.

import { get_pos_from_transform_mtx } from "../engine/math_util"

// Animation channels are (frame count, offset) pairs: three for the root's
// translation, then x/y/z rotation for each animated part in geo order:
// 0 root, 1 hips, 2 torso, 3 head, 4-7 left arm, 8-11 right arm and gun hand,
// 12-15 left leg, 16-19 right leg. The root, hips, torso, head and gun arm are
// pinned; the legs and the free left arm keep the walk's motion. The root's
// translation also stays animated, so he still bobs as he steps.
export const AIM_PARTS = [0, 1, 2, 3, 8, 9, 10, 11]
// The aiming pose is the first punch at this frame, with the arm fully extended.
export const AIM_FRAME = 10
const channel = (part, axis) => (3 + part * 3 + axis) * 2

// SM64's ANIM_FLAG_FORWARD actually plays an animation backwards.
const ANIM_FLAG_BACKWARDS = 1 << 1

const poseValue = (anim, index, frame) => {
    const count = anim.indices[index], offset = anim.indices[index + 1]
    return anim.values[offset + Math.min(frame, count - 1)]
}

export const pinParts = (base, pose, frame, parts = AIM_PARTS, { reverse = false } = {}) => {
    const values = [...base.values]
    const indices = [...base.indices]
    for (const part of parts) {
        for (let axis = 0; axis < 3; axis++) {
            const index = channel(part, axis)
            indices[index] = 1
            indices[index + 1] = values.length
            values.push(poseValue(pose, index, frame))
        }
    }
    return { ...base, indices, values, flags: reverse ? base.flags ^ ANIM_FLAG_BACKWARDS : base.flags }
}

// The shoulder's geo callback supplies the aim rotation. Keep the rest of
// the arm straight so the fist and barrel share its local +X direction.
export const createAimAnimation = (base, pose, frame, options) => {
    const animation = pinParts(base, pose, frame, AIM_PARTS, options)
    for (const part of [9, 10, 11]) {
        for (let axis = 0; axis < 3; axis++) {
            animation.values[animation.indices[channel(part, axis) + 1]] = 0
        }
    }
    return animation
}

// Geo matrices contain camera-space basis vectors. Replace only the shoulder's
// orientation, preserving its position and scale and the rest of Mario's pose.
export const alignAimArm = (matrix, cameraMatrix, targetPosition, aimYaw, muzzleHeight) => {
    const scale = Math.hypot(...matrix[0].slice(0, 3))
    let yaw = aimYaw * Math.PI / 0x8000, pitch = 0
    if (targetPosition) {
        const shoulder = [0, 0, 0]
        get_pos_from_transform_mtx(shoulder, matrix, cameraMatrix)
        const [dx, dy, dz] = targetPosition.map((value, axis) => value - shoulder[axis])
        const horizontal = Math.hypot(dx, dz)
        const distance = Math.hypot(horizontal, dy)
        if (distance > 0) {
            if (horizontal > 0) yaw = Math.atan2(dx, dz)
            // The barrel sits above the arm axis. Aim its centreline through
            // the target, accounting for that offset even at close range.
            pitch = Math.atan2(dy, horizontal) - Math.asin(Math.min(1, muzzleHeight * scale / distance))
        }
    }
    const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw)
    const sinPitch = Math.sin(pitch), cosPitch = Math.cos(pitch)
    const axes = [
        [sinYaw * cosPitch, sinPitch, cosYaw * cosPitch],
        [-sinYaw * sinPitch, cosPitch, -cosYaw * sinPitch],
        [-cosYaw, 0, sinYaw],
    ]
    for (let axis = 0; axis < 3; axis++) {
        for (let component = 0; component < 3; component++) {
            matrix[axis][component] = scale * axes[axis].reduce((sum, value, index) =>
                sum + value * cameraMatrix[index][component], 0)
        }
    }
}

// Which way Mario is moving relative to where he's facing: forward,
// backward, left or right (left is a positive yaw offset in SM64).
export const strafeDirection = (moveYaw, faceYaw) => {
    const offset = ((moveYaw - faceYaw + 32768) % 65536 + 65536) % 65536 - 32768
    if (Math.abs(offset) <= 0x2000) return 'forward'
    if (Math.abs(offset) >= 0x6000) return 'backward'
    return offset > 0 ? 'left' : 'right'
}
