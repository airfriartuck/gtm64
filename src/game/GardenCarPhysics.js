// GTA San Andreas car handling, ported from gta-reversed:
//   CAutomobile::ProcessControlInputs  pedals, handbrake and steering smoothing
//   CAutomobile::ProcessControl        wheel contact, traction and steering limit
//   CAutomobile::ProcessSuspension     springs and dampers on four suspension lines
//   CAutomobile::ProcessCarWheelPair   per-axle drive, brake and adhesion bias
//   CVehicle::ProcessWheel             the tyre friction circle, skids and wheelspin
//   cTransmission                      gear ratios and drive acceleration
//   cHandlingDataMgr::ConvertDataToGameUnits
//   CPhysical                          forces, springs, damping, air resistance
//
// GTA works in metres with a timestep of 1/50 s and Z up. Here Y is up (the
// same right/forward/up relationships hold), positions are in metres
// internally and SM64 runs at 30 fps, so each game frame is 50/30 GTA steps.
// SM64 has no ray casts or rigid-body collision, so suspension lines and the
// body are tested against SM64's floor and wall queries instead.

export const UNITS_PER_METRE = 100
const FRAME_STEP = 50 / 30
const SUBSTEPS = 2
const GRAVITY = 0.008 // CPhysical::ApplyGravity, m per step²

// handling.cfg fields for a 1960s muscle car. SA's handling.cfg isn't part of
// gta-reversed, so these are chosen in its format to drive like SA's muscle
// cars: rear-wheel drive, a heavy nose, soft springs and a loose tail.
export const MUSTANG_HANDLING = {
    mass: 1600, turnMass: 4000, dragMult: 2.0, centreOfMass: [0, -0.1, 0.1], // [right, up, forward]
    tractionMultiplier: 0.75, tractionLoss: 0.85, tractionBias: 0.47,
    gears: 5, maxVelocity: 165, engineAcceleration: 9.0, engineInertia: 10, driveType: 'R',
    brakeDeceleration: 5.0, brakeBias: 0.55, steeringLock: 35,
    suspensionForceLevel: 1.1, suspensionDampingLevel: 0.12,
    suspensionUpperLimit: 0.3, suspensionLowerLimit: -0.17,
    suspensionBiasFrontRear: 0.5, suspensionAntiDive: 0.3,
}

// Wheel centres measured from the Mustang model, in metres, as [right, up,
// forward] offsets from the car's origin (centre, at ground level). The car is
// symmetric, so GTA's wheel order (FL, RL, FR, RR) only matters front/back.
const WHEELS = [[0.7, 0.35, 1.4], [0.7, 0.35, -1.2], [-0.7, 0.35, 1.4], [-0.7, 0.35, -1.2]]
const WHEEL_RADIUS = 0.35
const FRONT = [true, false, true, false]

// SA's surfinfo.dat adhesion table isn't in gta-reversed either; rubber on
// SM64's surface classes, approximating its road / loose / slippery groups.
const SURFACE_ADHESION = { default: 2.0, slippery: 1.2, verySlippery: 0.7, notSlippery: 2.2 }
const SLIPPERY = new Set([0x0014, 0x002E, 0x0024]), VERY_SLIPPERY = new Set([0x0013, 0x0075]), NOT_SLIPPERY = new Set([0x0015])
const adhesiveLimit = floor => !floor ? SURFACE_ADHESION.default
    : VERY_SLIPPERY.has(floor.type) ? SURFACE_ADHESION.verySlippery
    : SLIPPERY.has(floor.type) ? SURFACE_ADHESION.slippery
    : NOT_SLIPPERY.has(floor.type) ? SURFACE_ADHESION.notSlippery : SURFACE_ADHESION.default

// CVehicle::ProcessWheel constants (0x8D34C0, 0x8D34C4) and the wheel friction
// used when coasting (cHandlingDataMgr::fWheelFriction).
const WS_TRAC_FRAC_LIMIT = 0.3, WS_ALREADY_SPINNING_LOSS = 0.2, WHEEL_FRICTION = 0.9
// CPhysical damping limits (0x8CD7A0, 0x8CD7A4); values as in re3.
const DAMPING_LIMIT_IN_FRAME = 0.25, DAMPING_LIMIT_OF_SPRING_FORCE = 0.999
const WHEEL_STATE = { NORMAL: 0, SPINNING: 1, SKIDDING: 2, FIXED: 3 }

// --- Vector helpers -------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = a => Math.hypot(a[0], a[1], a[2])
const normalise = a => { const l = length(a); return l > 0 ? scale(a, 1 / l) : [0, 0, 0] }
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const toRadians = units => units * Math.PI / 32768
const toUnits = radians => radians * 32768 / Math.PI

// --- Handling data → game units (cHandlingDataMgr::ConvertDataToGameUnits) ------
const ACCEL_CONST = 1 / (50 * 50), VELOCITY_CONST = 0.277778 / 50

// cTransmission::InitGearRatios
const initGearRatios = t => {
    t.gears = Array.from({ length: 6 }, () => ({ maxVelocity: 0, changeUp: 0, changeDown: 0 }))
    const averageHalfGearVelocity = 0.5 * t.maxVelocity / t.numberOfGears
    const maxGearVelocity = t.maxVelocity - averageHalfGearVelocity
    for (let i = 1; i <= t.numberOfGears; i++) {
        const gear = t.gears[i], previous = t.gears[i - 1]
        gear.maxVelocity = i * maxGearVelocity / t.numberOfGears + averageHalfGearVelocity
        const difference = gear.maxVelocity - previous.maxVelocity
        if (i >= t.numberOfGears) {
            gear.changeUp = t.maxVelocity
        } else {
            t.gears[i + 1].changeDown = 0.42 * difference + previous.maxVelocity
            gear.changeUp = 0.6667 * difference + previous.maxVelocity
        }
    }
    t.gears[0].maxVelocity = t.maxReverseVelocity
    t.gears[0].changeUp = -0.01
    t.gears[0].changeDown = t.maxReverseVelocity
    t.gears[1].changeDown = -0.01
}

export const handlingToGameUnits = raw => {
    const h = { ...raw }
    const t = { numberOfGears: raw.gears, driveType: raw.driveType,
        engineAcceleration: raw.engineAcceleration * ACCEL_CONST, engineInertia: raw.engineInertia,
        maxVelocity: raw.maxVelocity * VELOCITY_CONST }
    h.brakeDeceleration = raw.brakeDeceleration * ACCEL_CONST
    // Top speed where drag balances the engine.
    const engineAccelLimit = t.engineAcceleration / 6
    let maxVelocity = t.maxVelocity
    while (maxVelocity > 0) {
        maxVelocity -= 0.01
        if (h.dragMult >= 0.01) {
            if (maxVelocity * maxVelocity * (h.dragMult / 2) / 1000 <= engineAccelLimit) break
        } else if ((1 / (maxVelocity * maxVelocity * h.dragMult + 1) - 1) * -maxVelocity <= engineAccelLimit) break
    }
    t.maxVelocity = maxVelocity * 1.2
    t.maxFlatVelocity = maxVelocity
    t.maxReverseVelocity = Math.min(-maxVelocity * 0.3, -0.2)
    t.engineAcceleration /= t.driveType === '4' ? 4 : 2
    initGearRatios(t)
    h.transmission = t
    h.airResistance = h.dragMult <= 0.01 ? h.dragMult : h.dragMult / 1000 / 2 // GetDefaultAirResistance
    return h
}

// cTransmission::CalculateDriveAcceleration
export const calculateDriveAcceleration = (t, gas, state, velocity, driveWheelsOnGround, timeStep) => {
    if (velocity < t.maxReverseVelocity) return 0
    let inertia = true
    while (velocity <= t.maxVelocity) {
        const gear = t.gears[state.gear]
        let accelerate = false, shiftDown = false
        if (velocity > gear.changeUp) {
            if (state.gear === 0 && gas <= 0) accelerate = true
            else state.gear++
        } else {
            if (velocity >= gear.changeDown || state.gear === 0 || (state.gear === 1 && gas >= 0)) accelerate = true
            shiftDown = true
        }
        if (accelerate) {
            let speedMultiplier
            if (t.numberOfGears === 1) speedMultiplier = 1
            else if (state.gear >= 1) {
                const g = 1 - (state.gear - 1) / (t.numberOfGears - 1)
                speedMultiplier = g * g * 3 + 1
            } else speedMultiplier = 4.5 // reverse
            let drive = speedMultiplier * t.engineAcceleration * 0.4 * gas * timeStep
            if (inertia) {
                if (driveWheelsOnGround) {
                    const maxVelocityChange = t.maxVelocity / t.numberOfGears / 3
                    let fromDown, range
                    if (state.gear === 0) {
                        fromDown = maxVelocityChange - velocity
                        range = maxVelocityChange - t.gears[0].changeDown
                    } else if (state.gear === 1) {
                        fromDown = maxVelocityChange + velocity
                        range = maxVelocityChange + t.gears[1].changeUp
                    } else {
                        fromDown = velocity - gear.changeDown
                        range = gear.changeUp - gear.changeDown
                    }
                    const ratio = fromDown / range
                    const acceleration = clamp(1 - (ratio - state.inertia1) * t.engineInertia, 0.1, 1)
                    state.inertia1 = ratio
                    state.inertia2 = acceleration * 0.15 + 0.85 * state.inertia2
                    drive *= state.inertia2
                } else {
                    // Wheels in the air rev freely.
                    state.inertia1 = Math.min(1, state.inertia1 + Math.abs(gas) / t.engineInertia * timeStep * 0.1)
                    state.inertia2 = 0.1
                }
            }
            const gearMax = gear.maxVelocity
            if (gearMax >= 0 || velocity >= gearMax) {
                if (gearMax <= 0 || velocity <= gearMax) return drive
                return drive * (1 - Math.min((velocity - gearMax) / 0.05, 1))
            }
            return drive * (1 - Math.min((gearMax - velocity) / 0.05, 1))
        }
        if (shiftDown) state.gear--
        inertia = false
        if (velocity < t.maxReverseVelocity) return 0
    }
    return 0
}

// --- Rigid body (CPhysical) ------------------------------------------------------
const toWorld = (body, local) => add(add(scale(body.right, local[0]), scale(body.up, local[1])), scale(body.forward, local[2]))
const comWorld = body => toWorld(body, body.centreOfMass)
// CPhysical::GetMass(pos, dir): effective mass at an offset along a direction.
const massAt = (body, point, direction) => 1 / (dot(cross(point, direction), cross(point, direction)) / body.turnMass + 1 / body.mass)
// CPhysical::GetSpeed: velocity of a point given relative to the body position.
const speedAt = (body, point) => add(cross(body.turnSpeed, sub(point, comWorld(body))), body.moveSpeed)
const applyMoveForce = (body, force) => { body.moveSpeed = add(body.moveSpeed, scale(force, 1 / body.mass)) }
const applyTurnForce = (body, force, point) => {
    body.turnSpeed = add(body.turnSpeed, scale(cross(sub(point, comWorld(body)), force), 1 / body.turnMass))
}
const applyForce = (body, force, point) => { applyMoveForce(body, force); applyTurnForce(body, force, point) }

// CPhysical::ApplySpringCollisionAlt; returns the spring force, the damper's limit.
const applySpring = (body, h, direction, point, springLength, bias, normal, timeStep) => {
    const stress = 1 - springLength
    if (stress <= 0) return 0
    const n = dot(direction, normal) > 0 ? scale(normal, -1) : normal
    const force = stress * Math.min(timeStep, 3) * body.mass * h.suspensionForceLevel * bias * 0.016
    applyForce(body, scale(n, force), point)
    return force
}

// CPhysical::ApplySpringDampening
const applyDamper = (body, damping, limit, direction, point, contactSpeed, timeStep) => {
    const along = dot(contactSpeed, direction)
    const pointSpeed = dot(speedAt(body, point), direction)
    const dampingStep = clamp(Math.min(timeStep, 3) * damping, -DAMPING_LIMIT_IN_FRAME, DAMPING_LIMIT_IN_FRAME)
    let dampingSpeed = -(dampingStep * along)
    if (dampingSpeed > 0 && dampingSpeed + pointSpeed > 0) dampingSpeed = pointSpeed >= 0 ? 0 : -pointSpeed
    else if (dampingSpeed < 0 && dampingSpeed + pointSpeed < 0) dampingSpeed = pointSpeed <= 0 ? 0 : -pointSpeed
    const distance = sub(point, comWorld(body))
    const force = Math.min(massAt(body, distance, direction) * dampingSpeed, Math.abs(limit) * DAMPING_LIMIT_OF_SPRING_FORCE)
    applyForce(body, scale(direction, force), point)
}

// CVehicle::ProcessWheel: the friction circle for one tyre.
const processWheel = (body, h, wheelFwd, wheelRight, contactSpeed, contactPoint, wheelsOnGround,
    thrust, brake, adhesion, wheelId, wheelState, gas, timeStep) => {
    let right = 0, fwd = 0
    const speedFwd = dot(wheelFwd, contactSpeed), speedRight = dot(wheelRight, contactSpeed)
    const braking = brake !== 0
    const driving = !braking && thrust !== 0
    let alreadySkidding = false
    adhesion *= timeStep
    if (wheelState.value !== WHEEL_STATE.NORMAL) {
        alreadySkidding = true
        adhesion *= h.tractionLoss
        if (wheelState.value === WHEEL_STATE.SPINNING) adhesion *= 1 - Math.abs(gas) * WS_ALREADY_SPINNING_LOSS
    }
    wheelState.value = WHEEL_STATE.NORMAL
    if (speedRight !== 0) right = -(speedRight / wheelsOnGround)
    if (driving) {
        fwd = thrust
        right = clamp(right, -adhesion, adhesion)
    } else if (speedFwd !== 0) {
        fwd = -speedFwd / wheelsOnGround
        if (!braking && Math.abs(gas) < 0.01) {
            brake = WHEEL_FRICTION / body.mass
            if (brake > 500) brake *= 0.1
        }
        if (brake > adhesion) {
            if (Math.abs(speedFwd) > 0.005) wheelState.value = WHEEL_STATE.FIXED
        } else {
            fwd = clamp(fwd, -brake, brake)
        }
    }
    const speedSq = right * right + fwd * fwd
    if (speedSq > adhesion * adhesion) {
        if (wheelState.value !== WHEEL_STATE.FIXED) {
            let tractionLimit = WS_TRAC_FRAC_LIMIT
            if (speedFwd > 0.15 && (wheelId === 0 || wheelId === 2)) tractionLimit += tractionLimit
            wheelState.value = driving && tractionLimit * adhesion < Math.abs(fwd) ? WHEEL_STATE.SPINNING : WHEEL_STATE.SKIDDING
        }
        let tractionLoss = h.tractionLoss
        if (alreadySkidding) tractionLoss = 1
        else if (wheelState.value === WHEEL_STATE.SPINNING) tractionLoss *= 1 - Math.abs(gas) * WS_ALREADY_SPINNING_LOSS
        const l = Math.sqrt(speedSq)
        fwd *= adhesion * tractionLoss / l
        right *= adhesion * tractionLoss / l
    }
    if (fwd !== 0 || right !== 0) {
        const total = add(scale(wheelFwd, fwd), scale(wheelRight, right))
        let turnDirection = total, separate = false
        if (h.suspensionAntiDive > 0 && (braking || driving)) {
            separate = true
            turnDirection = sub(total, scale(wheelFwd, (braking ? 1 : 0.5) * h.suspensionAntiDive * fwd))
        }
        const speed = length(total)
        const turnSpeed = separate ? length(turnDirection) : speed
        const direction = normalise(total)
        turnDirection = separate ? normalise(turnDirection) : direction
        applyMoveForce(body, scale(direction, speed * body.mass))
        applyTurnForce(body, scale(turnDirection, turnSpeed * massAt(body, contactPoint, turnDirection)), contactPoint)
    }
}

// --- Car state ----------------------------------------------------------------------
const MUSTANG = handlingToGameUnits(MUSTANG_HANDLING)

const ensureBody = car => {
    if (car.body) return car.body
    const yaw = toRadians(car.yaw || 0)
    const forward = [Math.sin(yaw), 0, Math.cos(yaw)]
    car.body = {
        pos: [car.x / UNITS_PER_METRE, car.y / UNITS_PER_METRE, car.z / UNITS_PER_METRE],
        forward, up: [0, 1, 0], right: cross(forward, [0, 1, 0]),
        moveSpeed: [0, 0, 0], turnSpeed: [0, 0, 0],
        mass: MUSTANG.mass, turnMass: MUSTANG.turnMass,
        centreOfMass: [MUSTANG.centreOfMass[0], 0.5 + MUSTANG.centreOfMass[1], MUSTANG.centreOfMass[2]],
        compression: [1, 1, 1, 1], wheelCounts: [0, 0, 0, 0], wheelStates: WHEELS.map(() => ({ value: 0 })),
        contactNormals: WHEELS.map(() => [0, 1, 0]), contactPoints: WHEELS.map(() => [0, 0, 0]), floors: [],
        steer: 0, rawSteer: 0, gas: 0, brake: 0, handbrake: false,
        transmission: { gear: 1, inertia1: 0, inertia2: 0 },
    }
    return car.body
}

// Where a suspension line meets SM64's floor: compression 0 is fully up, 1 is no contact.
const SUSPENSION_LENGTH = MUSTANG.suspensionUpperLimit - MUSTANG.suspensionLowerLimit + WHEEL_RADIUS
const probeWheel = (body, wheel, collision) => {
    const start = add(body.pos, toWorld(body, [WHEELS[wheel][0], WHEELS[wheel][1] + MUSTANG.suspensionUpperLimit, WHEELS[wheel][2]]))
    const wrapper = {}
    const height = collision.find_floor(start[0] * UNITS_PER_METRE, start[1] * UNITS_PER_METRE, start[2] * UNITS_PER_METRE, wrapper) / UNITS_PER_METRE
    const floor = wrapper.floor
    if (!floor) return { compression: 1, floor: null }
    const normal = normalise([floor.normal.x || 0, floor.normal.y, floor.normal.z || 0])
    const direction = scale(body.up, -1)
    const along = dot(direction, normal)
    if (along >= -0.05) return { compression: 1, floor }
    // Plane through (start.x, height, start.z) with the floor's normal.
    const t = dot(sub([start[0], height, start[2]], start), normal) / along
    const compression = t / SUSPENSION_LENGTH
    if (compression >= 1 || compression < -0.5) return { compression: 1, floor }
    return { compression: Math.max(0, compression), point: add(start, scale(direction, t)), normal, floor }
}

// CAutomobile::ProcessControlInputs, from SM64's stick: up accelerates, down
// brakes then reverses, A is the handbrake and Z the footbrake.
const controlInputs = (body, input, forwardSpeed, timeStep) => {
    const steerTarget = clamp(-(input.stickX || 0) / 64, -1, 1)
    body.rawSteer = clamp(body.rawSteer + (steerTarget - body.rawSteer) / 5 * timeStep, -1, 1)
    body.handbrake = Boolean(input.buttonDownA || input.handbrake)
    const pedal = clamp((input.stickY || 0) / 64, -1, 1)
    if (input.buttonDownZ) [body.gas, body.brake] = [0, 1]
    else if (Math.abs(forwardSpeed) < 0.01) [body.gas, body.brake] = [pedal, 0]
    else if (forwardSpeed >= 0) [body.gas, body.brake] = pedal < 0 ? [0, -pedal] : [pedal, 0]
    else if (pedal >= 0 && (body.gas <= 0.5 || forwardSpeed <= -0.15)) [body.gas, body.brake] = [0, pedal]
    else [body.gas, body.brake] = [pedal, 0]
    body.steerAngle = MUSTANG.steeringLock * Math.PI / 180 * Math.sign(body.rawSteer) * body.rawSteer * body.rawSteer
}

// One GTA physics step (CAutomobile::ProcessControl's driving part).
const step = (car, input, collision, timeStep) => {
    const body = car.body, h = MUSTANG
    const forwardSpeed = dot(body.moveSpeed, body.forward)
    controlInputs(body, input, forwardSpeed, timeStep)

    body.moveSpeed[1] -= GRAVITY * timeStep

    // Suspension lines → compression, contact points and normals.
    for (let i = 0; i < 4; i++) {
        const hit = probeWheel(body, i, collision)
        body.compression[i] = hit.compression
        body.floors[i] = hit.floor
        if (hit.point) {
            body.contactPoints[i] = sub(hit.point, body.pos)
            body.contactNormals[i] = hit.normal
        }
    }

    // CAutomobile::ProcessSuspension
    const down = scale(body.up, -1)
    const limits = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
        if (body.compression[i] >= 1) continue
        const bias = FRONT[i] ? h.suspensionBiasFrontRear : 1 - h.suspensionBiasFrontRear
        limits[i] = applySpring(body, h, down, body.contactPoints[i], body.compression[i], bias, body.contactNormals[i], timeStep)
    }
    const contactSpeeds = body.contactPoints.map(point => speedAt(body, point))
    for (let i = 0; i < 4; i++) {
        if (body.compression[i] >= 1) continue
        const direction = body.contactNormals[i][1] > 0.35 ? scale(body.contactNormals[i], -1) : down
        applyDamper(body, h.suspensionDampingLevel, limits[i], direction, body.contactPoints[i], contactSpeeds[i], timeStep)
    }

    // Wheel contact counts (kept for a few steps after a wheel leaves the ground).
    let contactWheels = 0, driveWheelsOnGround = 0
    for (let i = 0; i < 4; i++) {
        if (body.compression[i] >= 1) {
            body.wheelCounts[i] = Math.max(body.wheelCounts[i] - timeStep, 0)
            if (body.wheelCounts[i] <= 0) continue
        } else body.wheelCounts[i] = 4
        contactWheels++
        if (h.transmission.driveType === '4' || (h.transmission.driveType === 'R') !== FRONT[i]) driveWheelsOnGround++
    }

    const brake = h.brakeDeceleration * body.brake * timeStep
    const acceleration = calculateDriveAcceleration(h.transmission, body.gas, body.transmission, forwardSpeed, driveWheelsOnGround, timeStep)
    const traction = h.tractionMultiplier / 250 * 0.25

    // Steering is limited at speed so the front tyres don't lose grip (player cars).
    let steerScale = 1
    if (forwardSpeed > 0.01 && (body.wheelCounts[0] > 0 || body.wheelCounts[1] > 0)) {
        const speedRight = dot(body.moveSpeed, body.right)
        steerScale = Math.asin(Math.min(SURFACE_ADHESION.default * traction * 16 / (forwardSpeed * forwardSpeed), 1)) / (h.steeringLock * Math.PI / 180)
        if ((body.steerAngle < 0 && speedRight > 0.05) || (body.steerAngle > 0 && speedRight < -0.05) || body.handbrake || steerScale > 1) steerScale = 1
    }
    const steerAngle = body.steerAngle * steerScale

    // CAutomobile::ProcessCarWheelPair, front then rear.
    for (const front of [true, false]) {
        const pair = front ? [0, 2] : [1, 3]
        const driveWheels = h.transmission.driveType === '4' || (h.transmission.driveType === 'R') !== front
        let pairBrake = brake, pairTraction = traction
        const suspensionBias = front ? 2 * h.suspensionBiasFrontRear : 2 - 2 * h.suspensionBiasFrontRear
        if (!front && body.handbrake) pairBrake = 20000
        if (!pair.some(i => body.wheelCounts[i] > 0)) continue
        const brakeBias = front ? 2 * h.brakeBias : 2 - 2 * h.brakeBias
        const tractionBias = front ? 2 * h.tractionBias : 2 - 2 * h.tractionBias
        for (const i of pair) {
            if (body.wheelCounts[i] <= 0) continue
            const normal = body.contactNormals[i]
            let wheelFwd = normalise(sub(body.forward, scale(normal, dot(body.forward, normal))))
            let wheelRight = normalise(cross(wheelFwd, normal))
            if (front) {
                const s = Math.sin(steerAngle), c = Math.cos(steerAngle)
                const turned = sub(scale(wheelFwd, c), scale(wheelRight, s))
                wheelRight = add(scale(wheelFwd, s), scale(wheelRight, c))
                wheelFwd = turned
            }
            let adhesion = adhesiveLimit(body.floors[i]) * pairTraction
            adhesion *= Math.min(suspensionBias * h.suspensionForceLevel * 4 * (1 - Math.min(body.compression[i], 1)), 2)
            const state = body.wheelStates[i]
            processWheel(body, h, wheelFwd, wheelRight, contactSpeeds[i], body.contactPoints[i], contactWheels,
                driveWheels ? acceleration : 0, pairBrake * brakeBias, adhesion * tractionBias, i, state, body.gas, timeStep)
            if (driveWheels && body.gas < 0 && state.value === WHEEL_STATE.SPINNING) state.value = WHEEL_STATE.NORMAL
        }
    }

    // CPhysical::ApplyAirResistance
    const drag = Math.pow(1 - length(body.moveSpeed) * h.airResistance, timeStep)
    body.moveSpeed = scale(body.moveSpeed, drag)
    body.turnSpeed = scale(body.turnSpeed, Math.pow(0.99, timeStep))
}

// CPhysical::ApplyMoveSpeed / ApplyTurnSpeed, then keep the axes orthonormal.
const integrate = (body, timeStep) => {
    body.pos = add(body.pos, scale(body.moveSpeed, timeStep))
    const turn = scale(body.turnSpeed, timeStep)
    body.pos = add(body.pos, cross(turn, toWorld(body, scale(body.centreOfMass, -1))))
    body.right = add(body.right, cross(turn, body.right))
    body.forward = add(body.forward, cross(turn, body.forward))
    body.up = add(body.up, cross(turn, body.up))
    body.forward = normalise(body.forward)
    body.right = normalise(cross(body.forward, body.up))
    body.up = normalise(cross(body.right, body.forward))
}

// SM64 surfaces the car must never enter: no floor, death planes, lava, deep
// water and low ceilings act as solid barriers rather than physics surfaces.
const BODY_POINTS = [[0.85, 0.5, 2.15], [-0.85, 0.5, 2.15], [0.85, 0.5, -2.1], [-0.85, 0.5, -2.1], [0.85, 0.5, 0], [-0.85, 0.5, 0]]
const forbidden = (collision, point, unsafeTypes) => {
    const [x, y, z] = point.map(v => v * UNITS_PER_METRE)
    const wrapper = {}
    const height = collision.find_floor(x, y + 100, z, wrapper)
    if (!wrapper.floor || unsafeTypes.includes(wrapper.floor.type)) return true
    if (collision.find_water_level(x, z) > height + 40) return true
    return collision.find_ceil(x, height + 20, z, {}) - height < 150
}

// Walls push the body out and remove the speed driving into them (GTA's car
// elasticity is a tiny 0.05); returns the speed lost, for crash reactions.
// Contacts are gathered first and resolved as one impulse at their average
// point, so a square hit on a wall doesn't spin the car.
const collideBody = (car, collision, unsafeTypes, previous) => {
    const body = car.body
    let lost = 0
    const contacts = []
    for (const local of BODY_POINTS) {
        const world = add(body.pos, toWorld(body, local))
        const probe = { x: world[0] * UNITS_PER_METRE, y: world[1] * UNITS_PER_METRE, z: world[2] * UNITS_PER_METRE }
        if (!collision.f32_find_wall_collision(probe, 0, 30)) continue
        const push = [(probe.x / UNITS_PER_METRE - world[0]), 0, (probe.z / UNITS_PER_METRE - world[2])]
        if (length(push) > 0) contacts.push({ point: toWorld(body, local), push })
    }
    if (contacts.length) {
        // Move out by the deepest push, then stop the motion into the wall.
        const deepest = contacts.reduce((a, b) => length(b.push) > length(a.push) ? b : a)
        body.pos = add(body.pos, deepest.push)
        const normal = normalise(contacts.reduce((sum, c) => add(sum, c.push), [0, 0, 0]))
        const point = scale(contacts.reduce((sum, c) => add(sum, c.point), [0, 0, 0]), 1 / contacts.length)
        const into = dot(speedAt(body, point), normal)
        if (into < 0) {
            applyForce(body, scale(normal, -into * 1.05 * massAt(body, sub(point, comWorld(body)), normal)), point)
            lost = -into
        }
    }
    // Hazards: put the car back where it was and stop it, like a wall.
    const hazard = WHEELS.some((wheel, i) => forbidden(collision, add(body.pos, toWorld(body, [wheel[0], 0.3, wheel[2]])), unsafeTypes))
    if (hazard) {
        lost = Math.max(lost, length(body.moveSpeed))
        Object.assign(body, previous)
        body.moveSpeed = [0, Math.min(0, body.moveSpeed[1]), 0]
        body.turnSpeed = [0, 0, 0]
    }
    return lost
}

// Keep the chassis out of the ground when the suspension bottoms out or the
// car lands on its roof (GTA's body collision does this for its col model).
const BOTTOM_POINTS = [[0.85, 0.1, 2.1], [-0.85, 0.1, 2.1], [0.85, 0.1, -2.05], [-0.85, 0.1, -2.05], [0, 1.1, 0]]
const supportBody = (body, collision) => {
    for (const local of BOTTOM_POINTS) {
        const offset = toWorld(body, local)
        const world = add(body.pos, offset)
        const wrapper = {}
        const height = collision.find_floor(world[0] * UNITS_PER_METRE, world[1] * UNITS_PER_METRE + 60, world[2] * UNITS_PER_METRE, wrapper) / UNITS_PER_METRE
        if (!wrapper.floor || world[1] >= height) continue
        const normal = normalise([wrapper.floor.normal.x || 0, wrapper.floor.normal.y, wrapper.floor.normal.z || 0])
        body.pos = add(body.pos, scale(normal, (height - world[1]) * normal[1]))
        const into = dot(speedAt(body, offset), normal)
        if (into < 0) applyForce(body, scale(normal, -into * 1.05 * massAt(body, sub(offset, comWorld(body)), normal)), offset)
    }
}

// Advance the car by one SM64 frame. input: { stickX, stickY, buttonDownA (handbrake), buttonDownZ (brake) }.
export const advanceCar = (car, input, collision, unsafeTypes) => {
    const body = ensureBody(car)
    const timeStep = FRAME_STEP / SUBSTEPS
    let lost = 0
    for (let i = 0; i < SUBSTEPS; i++) {
        const previous = { pos: [...body.pos], right: [...body.right], up: [...body.up], forward: [...body.forward] }
        step(car, input, collision, timeStep)
        integrate(body, timeStep)
        supportBody(body, collision)
        lost = Math.max(lost, collideBody(car, collision, unsafeTypes, previous))
    }
    // A parked, settled car sleeps instead of jittering on its springs.
    const idle = !input.stickX && !input.stickY
    if (idle && length(body.moveSpeed) < 0.002 && length(body.turnSpeed) < 0.0005 && body.compression.every(c => c < 1)) {
        body.moveSpeed = [0, 0, 0]
        body.turnSpeed = [0, 0, 0]
    }
    syncCar(car)
    car.impact = lost > 0.08 // ~15 km/h lost against a wall
}

// Mirror the body into the fields the game reads (SM64 units and angles).
const syncCar = car => {
    const body = car.body
    car.x = body.pos[0] * UNITS_PER_METRE
    car.y = body.pos[1] * UNITS_PER_METRE
    car.z = body.pos[2] * UNITS_PER_METRE
    // mtxf_rotate_zxy_and_translate: forward = (cx·sy, −sx, cx·cy); right.y = cx·sz, up.y = cx·cz.
    car.yaw = Math.round(toUnits(Math.atan2(body.forward[0], body.forward[2]))) & 0xffff
    car.pitch = Math.round(toUnits(Math.asin(clamp(-body.forward[1], -1, 1))))
    car.roll = Math.round(toUnits(Math.atan2(-body.right[1], body.up[1])))
    // Forward speed in SM64 units per frame, as before, plus GTA's km/h.
    const forward = dot(body.moveSpeed, body.forward)
    car.speed = forward * FRAME_STEP * UNITS_PER_METRE
    car.kmh = Math.abs(forward) * 50 * 3.6
    car.gear = body.transmission.gear
    car.wheelStates = body.wheelStates.map(state => state.value)
    car.onGround = body.compression.filter(c => c < 1).length
    car.floor = body.floors.find(Boolean) || car.floor
}

// True once a car nobody drives has come to rest on its wheels.
export const carAtRest = car => Boolean(car.body) && length(car.body.moveSpeed) === 0 && length(car.body.turnSpeed) === 0

// Stop the car dead (used when Mario gets out or the level changes).
export const stopCar = car => {
    const body = ensureBody(car)
    body.moveSpeed = [0, 0, 0]
    body.turnSpeed = [0, 0, 0]
    car.speed = 0
}

export const findCarExit = (state, collision, unsafeTypes) => {
    const angle = toRadians(state.yaw), sin = Math.sin(angle), cos = Math.cos(angle)
    for (const [side, forward] of [[220, 0], [-220, 0], [0, -330], [0, 330]]) {
        const x = state.x + side * cos + forward * sin
        const z = state.z - side * sin + forward * cos
        const exitFloor = {}
        const exitY = collision.find_floor(x, state.y + 150, z, exitFloor)
        if (!exitFloor.floor || exitFloor.floor.normal.y < 0.55 || unsafeTypes.includes(exitFloor.floor.type)
            || Math.abs(exitY - state.y) > 100 || collision.find_water_level(x, z) > exitY + 20) continue
        const wall = { x, y: exitY, z }
        if (collision.f32_find_wall_collision(wall, 60, 60)) continue
        if (collision.find_ceil(x, exitY + 80, z, {}) - exitY < 180) continue
        return { x, y: exitY, z, floor: exitFloor.floor }
    }
    return null
}
