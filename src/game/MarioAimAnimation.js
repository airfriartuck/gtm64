// Strafing animations for aiming: Mario keeps the steady aiming pose above
// the waist while his legs walk or sidestep. SM64 animations have no per-bone
// blending, so build composite animations whose upper-body channels are pinned
// to the aiming pose.

// Animation channels are (frame count, offset) pairs: three for the root's
// translation, then x/y/z rotation for each animated part in geo order:
// 0 root, 1 hips, 2 torso, 3 head, 4-7 left arm, 8-11 right arm and gun hand,
// 12-15 left leg, 16-19 right leg. The root, hips, torso, head and gun arm are
// pinned; the legs and the free left arm keep the walk's motion. The root's
// translation also stays animated, so he still bobs as he steps.
export const AIM_PARTS = [0, 1, 2, 3, 8, 9, 10, 11]
// In the air only the torso, head and gun arm hold the pose, so the root and
// hips still tuck and swing with the jump.
export const AIR_AIM_PARTS = [2, 3, 8, 9, 10, 11]
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

// Which way Mario is moving relative to where he's facing: forward,
// backward, left or right (left is a positive yaw offset in SM64).
export const strafeDirection = (moveYaw, faceYaw) => {
    const offset = ((moveYaw - faceYaw + 32768) % 65536 + 65536) % 65536 - 32768
    if (Math.abs(offset) <= 0x2000) return 'forward'
    if (Math.abs(offset) >= 0x6000) return 'backward'
    return offset > 0 ? 'left' : 'right'
}
