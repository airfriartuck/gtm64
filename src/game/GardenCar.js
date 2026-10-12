import { oPosX, oPosY, oPosZ, oFaceAnglePitch, oFaceAngleYaw, oFaceAngleRoll, oInteractStatus } from "../include/object_constants"
import { GRAPH_RENDER_INVISIBLE } from "../engine/graph_node"
import { LEVEL_CASTLE_GROUNDS } from "../levels/level_defines_constants"
import { SURFACE_DEATH_PLANE, SURFACE_BURNING } from "../include/surface_terrains"
import { advanceCar, findCarExit, stopCar, carAtRest } from "./GardenCarPhysics"

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

// Called in Mario's update, before ordinary walking/jumping and interactions.
// Mario remains the camera target, but his position follows the driver seat.
export const updateGardenCar = (m, idleAction, canEnter) => {
    const area = gLinker.Area
    if (!car || !car.object.activeFlags || area.gCurrLevelNum !== LEVEL_CASTLE_GROUNDS
        || area.gCurrentArea !== car.area || !m.action || !canEnter || m.health < 0x100) {
        if (car && car.driving) {
            car.driving = false
            stopCar(car)
            m.marioObj.gfx.flags &= ~GRAPH_RENDER_INVISIBLE
        }
        if (hud) hud.hidden = true
        return false
    }
    const input = window.playerInput
    const distance = Math.hypot(m.pos[0] - car.x, m.pos[2] - car.z)
    const near = distance < 450 && Math.abs(m.pos[1] - car.y) < 140
    const toggle = input.buttonPressedVehicle || input.buttonPressedB
    if (toggle && !car.driving && near && car.floor && !m.heldObj) {
        car.driving = true
        car.speed = 0
        m.prevAction = m.action
        m.action = idleAction
        m.actionState = m.actionTimer = m.actionArg = 0
    } else if (toggle && car.driving) {
        stopCar(car)
        const exit = findCarExit(car, gLinker.SurfaceCollision, unsafeTypes)
        if (exit) {
            car.driving = false
            m.pos = [exit.x, exit.y, exit.z]
            m.floor = exit.floor
            m.floorHeight = exit.y
            m.vel = [0, 0, 0]
            m.forwardVel = 0
            m.marioObj.gfx.pos = [...m.pos]
            m.marioObj.gfx.flags &= ~GRAPH_RENDER_INVISIBLE
            // Consume the exit button so Mario doesn't punch on this frame.
            input.buttonPressedB = false
            showHelp('Parked · E / B to enter the car')
            return false
        }
        showHelp('No room to exit here — drive to an open patch of grass')
        return true
    }
    if (!car.driving) {
        showHelp(near ? 'E / B to enter the car · Arrow keys / stick to drive' : 'Mustang parked near the starting lawn · Walk up and press E / B')
        return false
    }
    advanceCar(car, input, gLinker.SurfaceCollision, unsafeTypes)
    m.pos = [car.x, car.y, car.z]
    m.faceAngle = [0, car.yaw, 0]
    m.vel = [0, 0, 0]
    m.forwardVel = 0
    m.floor = car.floor
    m.floorHeight = car.y
    m.particleFlags = 0
    m.marioObj.rawData[oInteractStatus] = 0
    m.marioObj.gfx.pos = [...m.pos]
    m.marioObj.gfx.angle = [...m.faceAngle]
    m.marioObj.gfx.flags |= GRAPH_RENDER_INVISIBLE
    showHelp(`Driving · ↑ accelerate · ↓ brake / reverse · ← / → steer · Jump handbrake · Crouch brake · E / B exit · ${Math.round(car.kmh)} km/h · gear ${car.gear || 'R'}`)
    return true
}
