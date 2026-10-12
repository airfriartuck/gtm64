import { oPosX, oPosY, oPosZ, oFaceAnglePitch, oFaceAngleYaw, oFaceAngleRoll } from "../include/object_constants"
import { SURFACE_DEATH_PLANE, SURFACE_BURNING } from "../include/surface_terrains"
import { gMarioAnimData } from "../actors/mario/marioAnimData"
import { getGardenCar } from "./GardenCar"

const idleAnims = [gMarioAnimData[0xC3], gMarioAnimData[0xC4], gMarioAnimData[0xC5]] // head left/right/centre
const walking = gMarioAnimData[0x48]
const running = gMarioAnimData[0x72]
const jumping = gMarioAnimData[0x4D]
// Freeze the end of Mario's sit-down animation for the passenger pose.
const seated = { ...gMarioAnimData[0x84], flags: gMarioAnimData[0x84].flags | 4 }
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]))
const flatDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const wrap = angle => ((angle + 32768) % 65536 + 65536) % 65536 - 32768
const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]) * 32768 / Math.PI

// The Mustang's front passenger seat in car space (+Z is the nose, +X the
// driver's side), for Luigi's origin in his seated pose.
export const PASSENGER_SEAT = [-38, 25, 0]

const FOLLOW_GAP = 180       // how far behind Mario's trail Luigi stays
const LEASH = 900            // wandering never strays further than this from Mario
const CATCH_UP = 1800        // beyond this, Luigi reappears beside Mario
const WALK_SPEED = 14, RUN_SPEED = 30, MAX_SPEED = 40
const TURN_RATE = 0x0C00     // per frame, so he swings round instead of snapping
const MARIO_SETTLE_FRAMES = 45
const UNSAFE = [SURFACE_DEATH_PLANE, SURFACE_BURNING]

const approach = (value, target, up, down) =>
    value < target ? Math.min(target, value + up) : Math.max(target, value - down)

const turnTowards = (state, yaw, rate = TURN_RATE) => {
    const delta = wrap(yaw - state.yaw)
    state.yaw = wrap(state.yaw + Math.max(-rate, Math.min(rate, delta)))
}

// Height of safe, walkable ground under (x, z) near y, or null for water, lava,
// death floors, cliffs and steep slopes.
export const groundAt = (collision, x, y, z) => {
    const wrapper = {}
    const height = collision.find_floor(x, y + 100, z, wrapper)
    if (!wrapper.floor || wrapper.floor.normal.y < 0.7 || UNSAFE.includes(wrapper.floor.type)) return null
    if (collision.find_water_level(x, z) > height - 10) return null
    return height
}

// One step of ground travel: small rises and drops only, and no walls.
const stepGround = (collision, from, x, z) => {
    const height = groundAt(collision, x, from[1], z)
    if (height === null || height > from[1] + 40 || height < from[1] - 60) return null
    if (collision.f32_find_wall_collision({ x, y: height, z }, 40, 40)) return null
    return height
}

// A wander goal must be reachable in a straight line over safe ground.
const reachable = (collision, from, goal) => {
    const steps = Math.ceil(flatDistance(from, goal) / 40)
    let at = from
    for (let i = 1; i <= steps; i++) {
        const x = from[0] + (goal[0] - from[0]) * i / steps, z = from[2] + (goal[2] - from[2]) * i / steps
        const height = stepGround(collision, at, x, z)
        if (height === null) return null
        at = [x, height, z]
    }
    return at
}

const pickWanderGoal = (state, marioPos, world) => {
    for (let attempt = 0; attempt < 8; attempt++) {
        const angle = world.random() * Math.PI * 2
        const radius = 250 + world.random() * (LEASH - 350)
        const goal = [marioPos[0] + Math.sin(angle) * radius, 0, marioPos[2] + Math.cos(angle) * radius]
        const end = reachable(world.collision, state.pos, goal)
        if (end && Math.abs(end[1] - marioPos[1]) < 200) return end
    }
    return null
}

const pause = (state, world, frames) => {
    state.mode = 'pause'
    state.timer = frames
    state.goal = null
    state.lookAtMario = world.random() < 0.5
    state.idleAnim = Math.floor(world.random() * idleAnims.length)
    if (world.random() < 0.15) state.hop = 1
}

// Follow Mario's breadcrumb trail, easing speed with the remaining distance.
const follow = (state, world) => {
    let length = 0, previous = state.pos
    for (const point of state.path) { length += distance(previous, point); previous = point }
    // A small dead zone stops him shuffling forward by fractions once settled.
    const lag = length - FOLLOW_GAP
    const target = lag < 8 ? 0 : Math.min(MAX_SPEED, lag * 0.3)
    state.speed = approach(state.speed, target, 2.5, 5)
    let budget = state.speed
    while (budget > 0 && state.path.length) {
        const point = state.path[0]
        const gap = distance(state.pos, point)
        const step = Math.min(budget, gap)
        if (flatDistance(state.pos, point) > 0.1) turnTowards(state, yawTo(state.pos, point))
        if (gap > 0) state.pos = state.pos.map((value, i) => value + (point[i] - value) * step / gap)
        budget -= step
        if (gap <= step) state.path.shift()
    }
    // Never sink into the slope of a hill while cutting across to the trail.
    if (world) {
        const height = groundAt(world.collision, state.pos[0], state.pos[1], state.pos[2])
        if (height !== null && height > state.pos[1]) state.pos[1] = height
    }
}

const wander = (state, world) => {
    const target = state.running ? RUN_SPEED : WALK_SPEED
    const remaining = flatDistance(state.pos, state.goal)
    // Slow down for the last stretch so he doesn't stop dead.
    state.speed = approach(state.speed, Math.min(target, remaining * 0.25 + 2), 1.5, 3)
    turnTowards(state, yawTo(state.pos, state.goal))
    // Run along his own heading, so turns are arcs rather than pivots.
    const yaw = state.yaw * Math.PI / 32768
    const step = Math.min(state.speed, remaining)
    const x = state.pos[0] + Math.sin(yaw) * step, z = state.pos[2] + Math.cos(yaw) * step
    const height = stepGround(world.collision, state.pos, x, z)
    if (height === null) return pause(state, world, 20 + world.random() * 40)
    state.pos = [x, height, z]
    if (remaining < 25) pause(state, world, 40 + world.random() * 100)
}

// Car-space point → world, with the car's yaw, pitch and bank.
const carPoint = (car, [sx, sy, sz]) => {
    const yaw = car.yaw * Math.PI / 32768
    const pitch = (car.pitch || 0) * Math.PI / 32768
    const roll = (car.roll || 0) * Math.PI / 32768
    const x = sx * Math.cos(roll) - sy * Math.sin(roll)
    const y = sx * Math.sin(roll) + sy * Math.cos(roll)
    const z = sz * Math.cos(pitch) + y * Math.sin(pitch)
    return [car.x + x * Math.cos(yaw) + z * Math.sin(yaw),
        car.y + y * Math.cos(pitch) - sz * Math.sin(pitch),
        car.z - x * Math.sin(yaw) + z * Math.cos(yaw)]
}
// Where Luigi stands to climb in and lands when getting out.
export const PASSENGER_DOOR = [-140, 0, 10]
export const HOP_FRAMES = 20

// A hop over the convertible's door between two points, like Mario's.
const hop = (state, to) => {
    const t = Math.min(++state.hop.frame / HOP_FRAMES, 1)
    const k = t * t * (3 - 2 * t)
    state.pos = state.hop.from.map((v, i) => v + (to[i] - v) * k)
    state.pos[1] += Math.sin(Math.PI * t) * 80
    if (t >= 1) state.hop = null
    return t >= 1
}

// world = { collision, random } lets Luigi explore on his own; without it he
// only follows Mario's trail.
export const updateLuigi = (state, marioPos, car, world = null) => {
    if (car && car.driving) {
        const seat = carPoint(car, PASSENGER_SEAT)
        if (!state.riding) {
            // Climb in over the passenger door as the car sets off.
            state.riding = true
            state.hop = { from: [...state.pos], frame: 0, kind: 'in' }
            state.path = []
            state.trailEnd = null
            state.mode = 'follow'
            state.speed = 0
            state.hopHeight = 0
        }
        state.yaw = car.yaw
        if (state.hop && state.hop.kind === 'in' && !hop(state, seat)) return 'hopping'
        state.hop = null
        state.pos = seat
        return 'seated'
    }
    if (state.riding) {
        // Mario has got out: hop out of the passenger side too.
        state.riding = false
        state.path = []
        state.trailEnd = null
        if (car) {
            const door = carPoint(car, PASSENGER_DOOR)
            const ground = world && groundAt(world.collision, door[0], car.y, door[2])
            door[1] = ground === null || ground === undefined ? car.y : ground
            state.hop = { from: [...state.pos], frame: 0, kind: 'out', to: door }
        } else {
            state.pos = [...marioPos]
        }
    }
    if (state.hop && state.hop.kind === 'out') {
        if (!hop(state, state.hop.to)) return 'hopping'
        // Landed: stand for this frame, then pick up Mario's trail.
        state.lastMario = null
        return 'idle'
    }
    state.speed = state.speed || 0
    state.mode = state.mode || 'follow'
    if (state.riding || distance(state.pos, marioPos) > CATCH_UP) {
        // Catch up after a warp or dismount, rather than crossing unknown terrain.
        state.pos = [...marioPos]
        state.path = []
        state.trailEnd = null
        state.riding = false
        state.mode = 'follow'
        state.speed = 0
    }
    // Measure spacing from the last recorded trail point, even once Luigi has
    // walked the whole trail, so the samples stay on Mario's own path.
    const last = state.trailEnd || state.pos
    const previous = state.lastMario
    const marioMoved = !previous || distance(previous, marioPos) > 3
    // Keep the exact corner when Mario turns sharply, so Luigi doesn't cut it.
    const heading = previous && flatDistance(previous, marioPos) > 1 ? yawTo(previous, marioPos) : null
    if (heading !== null && state.marioHeading !== null && state.marioHeading !== undefined
        && Math.abs(wrap(heading - state.marioHeading)) > 0x0E00 && distance(last, previous) > 1) {
        state.path.push([...previous])
        state.trailEnd = [...previous]
    }
    if (heading !== null || !marioMoved) state.marioHeading = heading
    if (distance(state.trailEnd || state.pos, marioPos) > 20) {
        state.path.push([...marioPos])
        state.trailEnd = [...marioPos]
    }
    if (state.path.length > 256) state.path.shift()
    state.lastMario = [...marioPos]
    state.marioStill = marioMoved ? 0 : (state.marioStill || 0) + 1

    if (state.mode !== 'follow' && (marioMoved || flatDistance(state.pos, marioPos) > LEASH)) {
        // Mario is off again: head straight to him, then pick up his trail.
        state.mode = 'follow'
        state.path = [[...marioPos]]
        state.trailEnd = [...marioPos]
        state.hop = 0
    }

    if (state.mode === 'follow') {
        follow(state, world)
        if (world && state.speed < 0.5 && state.marioStill > MARIO_SETTLE_FRAMES) pause(state, world, 30 + world.random() * 60)
    } else if (state.mode === 'wander') {
        wander(state, world)
    } else {
        state.speed = approach(state.speed, 0, 0, 4)
        if (state.lookAtMario) turnTowards(state, yawTo(state.pos, marioPos), 0x400)
        if (--state.timer <= 0) {
            state.goal = pickWanderGoal(state, marioPos, world)
            if (state.goal) {
                state.mode = 'wander'
                state.running = world.random() < 0.4
            } else {
                pause(state, world, 30)
            }
        }
    }

    // A little hop on the spot now and then while waiting.
    if (state.hop) {
        state.hopHeight = Math.sin(state.hop / 20 * Math.PI) * 70
        if (++state.hop > 20) state.hop = state.hopHeight = 0
        return 'hopping'
    }
    state.hopHeight = 0
    if (state.speed < 0.5) return 'idle'
    return state.speed < 18 ? 'walking' : 'running'
}

const setAnimation = (info, anim, frame, speed) => {
    if (info.curAnim !== anim) {
        info.curAnim = anim
        info.animFrame = frame
        info.animFrameAccelAssist = frame << 16
        info.animYTrans = anim.unk02
    }
    // Like Mario's walk/run, the cycle speeds up with ground speed.
    info.animAccel = speed ? Math.round(speed * 0x10000) : 0
}

export const bhv_luigi_companion_loop = () => {
    const object = gLinker.ObjectListProcessor.gCurrentObject
    const m = gLinker.LevelUpdate.gMarioState
    if (!m || !m.marioObj || !m.action) return
    if (!object.luigi) object.luigi = {
        pos: [object.rawData[oPosX], object.rawData[oPosY], object.rawData[oPosZ]],
        yaw: object.rawData[oFaceAngleYaw], path: [], riding: false,
    }
    const state = object.luigi
    const car = getGardenCar()
    const world = gLinker.SurfaceCollision ? { collision: gLinker.SurfaceCollision, random: Math.random } : null
    const pose = updateLuigi(state, m.pos, car, world)
    const info = object.gfx.animInfo
    if (pose === 'seated') setAnimation(info, seated, seated.unk08 - 1, 0)
    else if (pose === 'hopping') setAnimation(info, jumping, jumping.unk04, 0)
    else if (pose === 'walking') setAnimation(info, walking, walking.unk04, Math.max(0.5, state.speed / 4))
    else if (pose === 'running') setAnimation(info, running, running.unk04, Math.max(1, state.speed / 4))
    else setAnimation(info, idleAnims[state.idleAnim || 0], idleAnims[state.idleAnim || 0].unk04, 0)
    object.gfx.scale = pose === 'seated' ? [0.65, 0.8, 0.65] : [0.9, 1.12, 0.9]
    ;[oPosX, oPosY, oPosZ].forEach((field, i) => { object.rawData[field] = state.pos[i] })
    object.rawData[oPosY] += state.hopHeight || 0
    object.rawData[oFaceAnglePitch] = state.riding ? car.pitch || 0 : 0
    object.rawData[oFaceAngleYaw] = state.yaw
    object.rawData[oFaceAngleRoll] = state.riding ? car.roll || 0 : 0
}
