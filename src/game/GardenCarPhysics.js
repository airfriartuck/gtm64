const radians = yaw => yaw * Math.PI / 32768
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const angleUnits = angle => angle * 32768 / Math.PI
const minimumGroundNormal = 0.55
const groundGradient = (normal, dx, dz) => -((normal.x || 0) * dx + (normal.z || 0) * dz) / normal.y

// Sample the chassis footprint as well as its centre: a centre-only check lets
// the wheels hang over the moat or the nose pass through a wall.
export const carGround = (collision, x, y, z, yaw, unsafeTypes) => {
    const angle = radians(yaw), sin = Math.sin(angle), cos = Math.cos(angle)
    let ground
    const wheels = []
    for (const [side, forward] of [[0,0], [-100,-175], [100,-175], [-100,175], [100,175]]) {
        const px = x + side * cos + forward * sin
        const pz = z - side * sin + forward * cos
        // Walk the floor from the centre to each wheel in short probes. This
        // follows changing slopes at a hill's foot/crest while rejecting an
        // abrupt ledge, even when a wheel is far above the chassis origin.
        const probes = ground ? Math.ceil(Math.hypot(side, forward) / 50) : 1
        const dx = (px - x) / probes, dz = (pz - z) / probes
        let sample = ground
        for (let step = 1; step <= probes; step++) {
            const sx = x + dx * step, sz = z + dz * step
            const predicted = sample ? sample.height + groundGradient(sample.floor.normal, dx, dz) : y
            const wrapper = {}
            const height = collision.find_floor(sx, predicted + 120, sz, wrapper)
            if (!wrapper.floor || wrapper.floor.normal.y < minimumGroundNormal
                || unsafeTypes.includes(wrapper.floor.type)
                || collision.find_water_level(sx, sz) > height + 20) return null
            if (sample) {
                const rise = (groundGradient(sample.floor.normal, dx, dz)
                    + groundGradient(wrapper.floor.normal, dx, dz)) / 2
                if (Math.abs(height - sample.height - rise) > 45) return null
            } else if (height > y + 50 || height < y - 60) return null
            sample = { height, floor: wrapper.floor }
        }
        const { height, floor } = sample
        const wall = { x: px, y: height, z: pz }
        if (collision.f32_find_wall_collision(wall, 90, 35)) return null
        if (collision.find_ceil(px, height + 100, pz, {}) - height < 235) return null
        if (side === 0 && forward === 0) ground = { height, floor }
        else wheels.push(height)
    }
    const rear = (wheels[0] + wheels[1]) / 2
    const front = (wheels[2] + wheels[3]) / 2
    const left = (wheels[0] + wheels[2]) / 2
    const right = (wheels[1] + wheels[3]) / 2
    ground.pitch = -angleUnits(Math.atan2(front - rear, 350))
    ground.roll = angleUnits(Math.atan2(right - left, 200))
    return ground
}

export const advanceCar = (state, input, collision, unsafeTypes) => {
    const throttle = clamp((input.stickY || 0) / 64, -1, 1)
    const steer = clamp((input.stickX || 0) / 64, -1, 1)
    if (input.buttonDownA || input.buttonDownZ) {
        state.speed *= 0.72
    } else if (Math.abs(throttle) > 0.1) {
        state.speed += throttle * (state.speed * throttle < 0 ? 3.5 : 1.8)
    } else {
        state.speed *= 0.96
    }
    state.speed = clamp(state.speed, -28, 70)
    if (Math.abs(state.speed) < 0.3) state.speed = 0
    const yaw = (state.yaw - steer * 850 * clamp(state.speed / 25, -1, 1)) & 0xffff
    // Substeps keep the car from tunnelling through narrow walls at full speed.
    const steps = Math.max(1, Math.ceil(Math.abs(state.speed) / 20))
    for (let i = 0; i < steps; i++) {
        const angle = radians(yaw)
        const x = state.x + Math.sin(angle) * state.speed / steps
        const z = state.z + Math.cos(angle) * state.speed / steps
        const ground = carGround(collision, x, state.y, z, yaw, unsafeTypes)
        if (!ground) {
            state.speed = 0
            break
        }
        Object.assign(state, { x, y: ground.height, z, yaw, floor: ground.floor,
            targetPitch: ground.pitch, targetRoll: ground.roll })
    }
    // Apply suspension once per game frame, independently of collision substeps.
    state.pitch = (state.pitch || 0) + ((state.targetPitch || 0) - (state.pitch || 0)) * 0.3
    state.roll = (state.roll || 0) + ((state.targetRoll || 0) - (state.roll || 0)) * 0.3
}

export const findCarExit = (state, collision, unsafeTypes) => {
    const angle = radians(state.yaw), sin = Math.sin(angle), cos = Math.cos(angle)
    for (const [side, forward] of [[320,0], [-320,0], [0,-350], [0,350]]) {
        const x = state.x + side * cos + forward * sin
        const z = state.z - side * sin + forward * cos
        const normal = state.floor.normal
        const expectedHeight = state.y - ((normal.x || 0) * (x - state.x) + (normal.z || 0) * (z - state.z)) / normal.y
        // Exit searches need the same slope-aware height as the wheel probes.
        const exitFloor = {}
        const exitY = collision.find_floor(x, expectedHeight + 120, z, exitFloor)
        if (!exitFloor.floor || exitFloor.floor.normal.y < minimumGroundNormal || unsafeTypes.includes(exitFloor.floor.type)
            || Math.abs(exitY - expectedHeight) > 100 || collision.find_water_level(x, z) > exitY + 20) continue
        const wall = { x, y: exitY, z }
        if (collision.f32_find_wall_collision(wall, 60, 60)) continue
        const ceiling = collision.find_ceil(x, exitY + 80, z, {})
        if (ceiling - exitY < 180) continue
        return { x, y: exitY, z, floor: exitFloor.floor }
    }
    return null
}
