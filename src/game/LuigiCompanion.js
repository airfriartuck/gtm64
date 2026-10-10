import { oPosX, oPosY, oPosZ, oFaceAnglePitch, oFaceAngleYaw, oFaceAngleRoll } from "../include/object_constants"
import { gMarioAnimData } from "../actors/mario/marioAnimData"
import { getGardenCar } from "./GardenCar"

const idle = gMarioAnimData[0xC3]
const running = gMarioAnimData[0x72]
// Freeze the end of Mario's sit-down animation for the passenger pose.
const seated = { ...gMarioAnimData[0x84], flags: gMarioAnimData[0x84].flags | 4 }
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]))

export const updateLuigi = (state, marioPos, car) => {
    if (car && car.driving) {
        const yaw = car.yaw * Math.PI / 32768
        // Local passenger seat, rotated with the car's yaw, pitch and bank.
        const pitch = (car.pitch || 0) * Math.PI / 32768
        const roll = (car.roll || 0) * Math.PI / 32768
        const x = 48 * Math.cos(roll) - 125 * Math.sin(roll)
        const y = 48 * Math.sin(roll) + 125 * Math.cos(roll)
        const z = -25 * Math.cos(pitch) + y * Math.sin(pitch)
        state.pos = [car.x + x * Math.cos(yaw) + z * Math.sin(yaw),
            car.y + y * Math.cos(pitch) + 25 * Math.sin(pitch),
            car.z - x * Math.sin(yaw) + z * Math.cos(yaw)]
        state.yaw = car.yaw
        state.path = []
        state.riding = true
        return 'seated'
    }
    if (state.riding || distance(state.pos, marioPos) > 1800) {
        // Catch up after a warp or dismount, rather than crossing unknown terrain.
        state.pos = [...marioPos]
        state.path = []
        state.riding = false
    }
    const last = state.path[state.path.length - 1] || state.pos
    if (distance(last, marioPos) > 20) state.path.push([...marioPos])
    if (state.path.length > 256) state.path.shift()
    let length = 0, previous = state.pos
    for (const point of state.path) { length += distance(previous, point); previous = point }
    let budget = Math.min(36, Math.max(0, length - 180))
    const moving = budget > 0.5
    while (budget > 0 && state.path.length) {
        const target = state.path[0]
        const gap = distance(state.pos, target)
        const step = Math.min(budget, gap)
        const dx = target[0] - state.pos[0], dz = target[2] - state.pos[2]
        if (Math.hypot(dx, dz) > 0.1) state.yaw = Math.atan2(dx, dz) * 32768 / Math.PI
        if (gap > 0) state.pos = state.pos.map((value, i) => value + (target[i] - value) * step / gap)
        budget -= step
        if (gap <= step) state.path.shift()
    }
    return moving ? 'running' : 'idle'
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
    const pose = updateLuigi(state, m.pos, car)
    const anim = pose === 'seated' ? seated : pose === 'running' ? running : idle
    const info = object.gfx.animInfo
    if (info.curAnim !== anim) {
        info.curAnim = anim
        info.animFrame = pose === 'seated' ? anim.unk08 - 1 : anim.unk04
        info.animAccel = 0
        info.animYTrans = anim.unk02
    }
    object.gfx.scale = pose === 'seated' ? [0.65, 0.8, 0.65] : [0.9, 1.12, 0.9]
    ;[oPosX, oPosY, oPosZ].forEach((field, i) => { object.rawData[field] = state.pos[i] })
    object.rawData[oFaceAnglePitch] = state.riding ? car.pitch || 0 : 0
    object.rawData[oFaceAngleYaw] = state.yaw
    object.rawData[oFaceAngleRoll] = state.riding ? car.roll || 0 : 0
}
