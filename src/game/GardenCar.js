import { oPosX, oPosY, oPosZ, oFaceAnglePitch, oFaceAngleYaw, oFaceAngleRoll, oInteractStatus } from "../include/object_constants"
import { GRAPH_RENDER_INVISIBLE } from "../engine/graph_node"
import { LEVEL_CASTLE_GROUNDS } from "../levels/level_defines_constants"
import { SURFACE_DEATH_PLANE, SURFACE_BURNING } from "../include/surface_terrains"
import { advanceCar, findCarExit, stopCar, carAtRest } from "./GardenCarPhysics"
import { beginEnter, beginExit, exitMode, seatedPose, stepSequence } from "./CarEnterExit"

const unsafeTypes = [SURFACE_DEATH_PLANE, SURFACE_BURNING]
let car, hud

export const getGardenCar = () => car && car.object.activeFlags
    && car.area === gLinker.Area.gCurrentArea ? car : null

const showHelp = message => {
    if (!hud) {
        hud = document.createElement('div')
        hud.id = 'garden-car-help'
        hud.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:1000;padding:10px 16px;border-radius:8px;background:rgba(15,20,30,.88);color:white;font:14px sans-serif;pointer-events:none;text-align:center;max-width:90vw'
        document.body.appendChild(hud)
    }
    hud.hidden = !message
    if (message && hud.textContent !== message) hud.textContent = message
}

export const bhv_garden_car_loop = () => {
    const object = gLinker.ObjectListProcessor.gCurrentObject
    if (!object.gardenCar) {
        const wrapper = {}
        const y = gLinker.SurfaceCollision.find_floor(object.rawData[oPosX], object.rawData[oPosY] + 150,
            object.rawData[oPosZ], wrapper)
        object.gardenCar = {
            object, area: gLinker.Area.gCurrentArea, speed: 0, driving: false, pitch: 0, roll: 0,
            x: object.rawData[oPosX], y: wrapper.floor ? y : object.rawData[oPosY],
            z: object.rawData[oPosZ], yaw: object.rawData[oFaceAngleYaw], floor: wrapper.floor,
        }
    }
    car = object.gardenCar
    // A car nobody is driving still settles on its springs and rolls to a stop.
    if (!car.driving && !carAtRest(car)) advanceCar(car, {}, gLinker.SurfaceCollision, unsafeTypes)
    object.rawData[oPosX] = car.x
    object.rawData[oPosY] = car.y
    object.rawData[oPosZ] = car.z
    object.rawData[oFaceAngleYaw] = car.yaw
    object.rawData[oFaceAnglePitch] = car.pitch
    object.rawData[oFaceAngleRoll] = car.roll
}

// Mario animations driven directly while he's in or around the car. Frames
// set from a sequence use a frozen copy (ANIM_FLAG_2) so the renderer doesn't
// advance them; walking plays normally at a pace-matched speed.
const ANIM_FLAG_FROZEN = 4
const frozenAnims = new Map()
const setMarioAnimation = (m, anim) => {
    const list = m.animation && m.animation.animList
    const info = m.marioObj.gfx.animInfo
    if (!list || !list[anim.id] || !info) return
    const pinned = anim.speed === undefined
    let target = list[anim.id]
    if (pinned) {
        if (!frozenAnims.has(target)) frozenAnims.set(target, { ...target, flags: target.flags | ANIM_FLAG_FROZEN })
        target = frozenAnims.get(target)
    }
    const id = pinned ? anim.id | 0x2000 : anim.id
    if (info.animID !== id) {
        info.animID = id
        info.curAnim = target
        info.animYTrans = m.unkB0
        info.animFrame = target.unk04
        info.animFrameAccelAssist = target.unk04 << 16
    }
    m.animation.targetAnim = target
    info.animAccel = pinned ? 0 : Math.round(anim.speed * 0x10000)
    if (!pinned) return
    const last = target.unk08 - 1
    const frame = anim.frame === 'end' ? last
        : anim.frame !== undefined ? anim.frame
        : Math.round(target.unk04 + Math.min(1, Math.max(0, anim.progress || 0)) * (last - target.unk04))
    info.animFrame = frame
    info.animFrameAccelAssist = frame << 16
}

// Pose Mario from a sequence frame or the driver's seat.
const applyPose = (m, pose) => {
    m.pos = [...pose.pos]
    m.faceAngle = [0, Math.round(pose.angle[1]), 0]
    m.vel = [0, 0, 0]
    m.forwardVel = 0
    m.particleFlags = 0
    m.marioObj.rawData[oInteractStatus] = 0
    const gfx = m.marioObj.gfx
    gfx.pos = [...pose.pos]
    gfx.angle = pose.angle.map(Math.round)
    gfx.scale = [pose.scale, pose.scale, pose.scale]
    gfx.flags &= ~GRAPH_RENDER_INVISIBLE
    setMarioAnimation(m, pose.anim)
}

const resetMarioModel = m => {
    m.marioObj.gfx.scale = [1, 1, 1]
    m.marioObj.gfx.flags &= ~GRAPH_RENDER_INVISIBLE
}

const groundAt = (x, z, nearY) => {
    const wrapper = {}
    const height = gLinker.SurfaceCollision.find_floor(x, nearY + 150, z, wrapper)
    return wrapper.floor ? height : nearY
}

const placeMario = (m, pos) => {
    const wrapper = {}
    m.pos = [...pos]
    m.floorHeight = gLinker.SurfaceCollision.find_floor(pos[0], pos[1] + 100, pos[2], wrapper)
    m.floor = wrapper.floor || m.floor
    m.marioObj.gfx.pos = [...m.pos]
}

const DRIVING_HELP = 'Driving · ↑ accelerate · ↓ brake / reverse · ← / → steer · Jump handbrake · Crouch brake · E / B exit'

// Called in Mario's update, before ordinary walking/jumping and interactions.
// actions: { idle, dive, setAction(m, action, arg) } from Mario.js. Returns true
// while the car owns Mario this frame (entering, driving or getting out).
export const updateGardenCar = (m, actions, canEnter) => {
    const area = gLinker.Area
    if (!car || !car.object.activeFlags || area.gCurrLevelNum !== LEVEL_CASTLE_GROUNDS
        || area.gCurrentArea !== car.area || !m.action || !canEnter || m.health < 0x100) {
        if (car && (car.driving || car.sequence)) {
            car.driving = false
            car.sequence = null
            car.waitingToExit = false
            stopCar(car)
            resetMarioModel(m)
        }
        if (hud) hud.hidden = true
        return false
    }
    const input = window.playerInput
    const toggle = input.buttonPressedVehicle || input.buttonPressedB

    if (!car.driving && !car.sequence) {
        const distance = Math.hypot(m.pos[0] - car.x, m.pos[2] - car.z)
        const near = distance < 450 && Math.abs(m.pos[1] - car.y) < 140
        if (!(toggle && near && car.floor && !m.heldObj)) {
            showHelp(near ? 'E / B to get in · Arrow keys / stick to drive' : 'Mustang parked near the starting lawn · Walk up and press E / B')
            return false
        }
        // Walk to the driver's door and climb in (CTaskComplexEnterCarAsDriver).
        car.sequence = beginEnter(m.pos, m.faceAngle[1])
        m.prevAction = m.action
        m.action = actions.idle
        m.actionState = m.actionTimer = m.actionArg = 0
    }

    if (car.driving) {
        // Exit request: step out if stopped, roll out at speed, else brake and wait.
        if (toggle) car.waitingToExit = true
        if (car.waitingToExit) {
            const mode = exitMode(car)
            if (mode === 'step') {
                const exit = findCarExit(car, gLinker.SurfaceCollision, unsafeTypes)
                if (exit) {
                    car.sequence = beginExit('step', [exit.x, exit.y, exit.z])
                } else {
                    car.waitingToExit = false
                    car.noRoomFrames = 90
                }
            } else if (mode === 'jump') {
                car.sequence = beginExit('jump')
            }
            if (car.sequence) {
                car.driving = false
                car.waitingToExit = false
            }
        }
        if (car.driving) {
            const controls = car.waitingToExit ? { buttonDownA: true, buttonDownZ: true } : input
            advanceCar(car, controls, gLinker.SurfaceCollision, unsafeTypes)
            applyPose(m, seatedPose(car))
            m.floor = car.floor
            m.floorHeight = car.y
            if (car.noRoomFrames > 0) {
                car.noRoomFrames--
                showHelp('No room to get out here — drive to an open patch of grass')
            } else {
                showHelp(car.waitingToExit ? `Stopping to get out · ${Math.round(car.kmh)} km/h`
                    : `${DRIVING_HELP} · ${Math.round(car.kmh)} km/h · gear ${car.gear || 'R'}`)
            }
            return true
        }
    }

    // A sequence owns Mario: entering, stepping out or rolling out.
    if (hud) hud.hidden = true
    const sequence = car.sequence
    const pose = stepSequence(sequence, car, groundAt)
    applyPose(m, pose)
    if (!pose.done) return true
    car.sequence = null
    if (sequence.kind === 'enter') {
        car.driving = true
        return true
    }
    resetMarioModel(m)
    if (sequence.kind === 'jump') {
        // CTaskSimpleCarJumpOut: dive clear in the direction of travel and roll.
        const yaw = Math.round(pose.angle[1]) & 0xffff
        placeMario(m, pose.pos)
        m.faceAngle = [0, yaw, 0]
        m.forwardVel = Math.min(48, Math.max(24, Math.abs(car.speed) * 0.6))
        m.vel = [0, 20, 0]
        actions.setAction(m, actions.dive, 0)
        return false
    }
    placeMario(m, pose.pos)
    m.vel = [0, 0, 0]
    m.forwardVel = 0
    m.action = actions.idle
    m.actionState = m.actionTimer = m.actionArg = 0
    // Consume the button so Mario doesn't punch on landing.
    input.buttonPressedB = false
    showHelp('Parked · E / B to get in')
    return false
}

gLinker.GardenCar = { getGardenCar }
