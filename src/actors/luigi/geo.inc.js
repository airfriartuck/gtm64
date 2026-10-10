import * as Geo from "../../engine/GeoLayout"
import { mario_geo_body, mario_geo_face_and_wings } from "../mario/geo.inc"
import { mario_cap_on_eyes_front, mario_red_lights_group, mario_texture_m_logo } from "../mario/model.inc"
import { gdSPDefLights1 } from "../../include/gbi"
import { SHADOW_CIRCLE_4_VERTS } from "../../game/Shadow"

const green = gdSPDefLights1(0, 100, 0, 0, 200, 0, 40, 40, 40)

// The cap badge uses the same 32x32 RGBA16 format and UVs as Mario's badge.
export const luigiTextureLogo = []
for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
        const badge = Math.hypot(x - 15.5, y - 15.5) < 13
        const letter = (x >= 10 && x <= 14 && y >= 7 && y <= 24)
            || (x >= 10 && x <= 22 && y >= 20 && y <= 24)
        const rgba16 = badge && !letter ? 0xffff : (25 << 6) | 1
        luigiTextureLogo.push(rgba16 >> 8, rgba16 & 255)
    }
}

const copies = new Map()
const copyDisplayList = list => {
    if (!list) return list
    if (copies.has(list)) return copies.get(list)
    const result = []
    copies.set(list, result)
    for (const command of list) {
        if (typeof command.words.w1 !== 'object' || command.words.w1 === null) {
            result.push(command)
            continue
        }
        const payload = { ...command.words.w1 }
        if (payload.childDisplayList) payload.childDisplayList = copyDisplayList(payload.childDisplayList)
        if (payload.data === mario_red_lights_group.l[0]) payload.data = green.l[0]
        if (payload.data === mario_red_lights_group.a) payload.data = green.a
        if (payload.imageData === mario_texture_m_logo) payload.imageData = luigiTextureLogo
        result.push({ words: { ...command.words, w1: payload } })
    }
    return result
}

// Keep Mario's skeleton, but remove callbacks that read Mario's cap, held
// object or body state. Luigi has independent animations and always wears a cap.
const copyLayout = layout => layout.flatMap(node => {
    if (node.command === Geo.GEO_ASM().command || node.command === Geo.GEO_HELD_OBJECT().command) return []
    const args = [...node.args]
    if (node.command === Geo.GEO_BRANCH().command) {
        args[1] = args[1] === mario_geo_face_and_wings
            ? [Geo.GEO_DISPLAY_LIST(Geo.LAYER_OPAQUE, copyDisplayList(mario_cap_on_eyes_front)), Geo.GEO_RETURN()]
            : copyLayout(args[1])
    } else if (node.command === Geo.GEO_SWITCH_CASE().command) {
        args[1] = (context, graphNode) => { graphNode.selectedCase = 0 }
        args[2] = undefined
    } else if (node.command === Geo.GEO_ANIMATED_PART().command) {
        args[4] = copyDisplayList(args[4])
    } else if (node.command === Geo.GEO_DISPLAY_LIST().command) {
        args[1] = copyDisplayList(args[1])
    }
    return [{ command: node.command, args }]
})

const body = copyLayout(mario_geo_body)
export const luigi_geo = () => [
    Geo.GEO_CULLING_RADIUS(450), Geo.GEO_OPEN_NODE(),
    Geo.GEO_SHADOW(SHADOW_CIRCLE_4_VERTS, 150, 80), Geo.GEO_OPEN_NODE(),
    Geo.GEO_SCALE(0, 16384), Geo.GEO_OPEN_NODE(),
    Geo.GEO_BRANCH(1, body),
    Geo.GEO_CLOSE_NODE(), Geo.GEO_CLOSE_NODE(), Geo.GEO_CLOSE_NODE(), Geo.GEO_END(),
]
