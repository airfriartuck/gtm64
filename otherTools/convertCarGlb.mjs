// Bake a glTF binary (.glb) car into an SM64 vertex-coloured display list.
//
//   node otherTools/convertCarGlb.mjs <in.glb> <out.js> [triangles=4500] [length=430]
//
// The game's N64 renderer draws every triangle in JavaScript, so the model is
// simplified (meshoptimizer) and its textures are sampled into per-triangle
// colours. Glass (translucent materials) goes to a separate translucent list.
// The car is turned to face +Z, centred, scaled to `length` units nose to
// tail, and sits with its wheels on y = 0.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { MeshoptSimplifier } from 'meshoptimizer'

const [input, output, targetArg, lengthArg] = process.argv.slice(2)
if (!input || !output) {
    console.error('usage: node otherTools/convertCarGlb.mjs <in.glb> <out.js> [triangles] [length]')
    process.exit(1)
}
const TARGET_TRIANGLES = Number(targetArg || 4500)
const CAR_LENGTH = Number(lengthArg || 430)

// --- GLB container -----------------------------------------------------------
const file = fs.readFileSync(input)
if (file.readUInt32LE(0) !== 0x46546C67) throw new Error('not a .glb file')
let offset = 12, gltf, bin
while (offset < file.length) {
    const length = file.readUInt32LE(offset), type = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4E4F534A) gltf = JSON.parse(chunk.toString('utf8'))
    if (type === 0x004E4942) bin = chunk
    offset += 8 + length
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const READERS = {
    5120: [1, 'readInt8', 127], 5121: [1, 'readUInt8', 255], 5122: [2, 'readInt16LE', 32767],
    5123: [2, 'readUInt16LE', 65535], 5125: [4, 'readUInt32LE', 1], 5126: [4, 'readFloatLE', 1],
}
const readAccessor = index => {
    const accessor = gltf.accessors[index]
    const view = gltf.bufferViews[accessor.bufferView]
    const [size, method, max] = READERS[accessor.componentType]
    const count = COMPONENTS[accessor.type]
    const stride = view.byteStride || size * count
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0)
    const out = new Float64Array(accessor.count * count)
    for (let i = 0; i < accessor.count; i++) {
        for (let c = 0; c < count; c++) {
            const value = bin[method](start + i * stride + c * size)
            out[i * count + c] = accessor.normalized ? Math.max(value / max, -1) : value
        }
    }
    return out
}

// --- Textures ----------------------------------------------------------------
const images = new Map()
const decodeImage = index => {
    if (images.has(index)) return images.get(index)
    const image = gltf.images[index]
    const view = gltf.bufferViews[image.bufferView]
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)
    const decoded = image.mimeType === 'image/jpeg'
        ? jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
        : PNG.sync.read(Buffer.from(bytes))
    images.set(index, decoded)
    return decoded
}
const toLinear = c => Math.pow(c / 255, 2.2)
const sample = (image, u, v) => {
    const wrap = t => t - Math.floor(t)
    const x = Math.min(image.width - 1, Math.floor(wrap(u) * image.width))
    const y = Math.min(image.height - 1, Math.floor(wrap(v) * image.height))
    const i = (y * image.width + x) * 4
    return [toLinear(image.data[i]), toLinear(image.data[i + 1]), toLinear(image.data[i + 2]), image.data[i + 3] / 255]
}

// --- Scene graph -------------------------------------------------------------
const multiply = (a, b) => {
    const out = new Array(16).fill(0)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
    return out
}
const nodeMatrix = node => {
    if (node.matrix) return node.matrix
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1]
    const [sx, sy, sz] = node.scale || [1, 1, 1]
    const [tx, ty, tz] = node.translation || [0, 0, 0]
    return [
        (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
        (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
        (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
    ]
}
const transform = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]

// Each primitive becomes a part: world positions, per-vertex colour and alpha.
const parts = []
const visit = (index, parent) => {
    const node = gltf.nodes[index]
    const world = multiply(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
        for (const primitive of gltf.meshes[node.mesh].primitives) {
            const material = gltf.materials[primitive.material] || {}
            const pbr = material.pbrMetallicRoughness || {}
            const factor = pbr.baseColorFactor || [1, 1, 1, 1]
            const texture = pbr.baseColorTexture && gltf.textures[pbr.baseColorTexture.index]
            const image = texture && decodeImage(texture.source)
            const local = readAccessor(primitive.attributes.POSITION)
            const uvs = primitive.attributes.TEXCOORD_0 !== undefined && readAccessor(primitive.attributes.TEXCOORD_0)
            const count = local.length / 3
            const positions = new Float32Array(count * 3)
            const colours = new Float32Array(count * 4)
            for (let i = 0; i < count; i++) {
                positions.set(transform(world, local[i * 3], local[i * 3 + 1], local[i * 3 + 2]), i * 3)
                const texel = image && uvs ? sample(image, uvs[i * 2], uvs[i * 2 + 1]) : [1, 1, 1, 1]
                for (let c = 0; c < 4; c++) colours[i * 4 + c] = texel[c] * factor[c]
            }
            const indices = primitive.indices !== undefined
                ? Uint32Array.from(readAccessor(primitive.indices)) : Uint32Array.from({ length: count }, (_, i) => i)
            const alpha = colours.reduce((sum, value, i) => i % 4 === 3 ? sum + value : sum, 0) / count
            parts.push({ positions, colours, indices, glass: material.alphaMode === 'BLEND' && alpha < 0.6 })
        }
    }
    for (const child of node.children || []) visit(child, world)
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
for (const root of gltf.scenes[gltf.scene || 0].nodes) visit(root, identity)

// --- Simplify ------------------------------------------------------------------
await MeshoptSimplifier.ready
const totalTriangles = parts.reduce((sum, part) => sum + part.indices.length / 3, 0)
const ratio = Math.min(1, TARGET_TRIANGLES / totalTriangles)
for (const part of parts) {
    const target = Math.max(3, Math.floor(part.indices.length * ratio / 3) * 3)
    // Keep colour boundaries (paint vs chrome vs tyre) while collapsing edges.
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(part.indices, part.positions, 3,
        part.colours, 4, [0.5, 0.5, 0.5, 0.2], null, target, 0.05)
    part.indices = simplified
}

// --- Orient, scale and centre --------------------------------------------------
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
for (const part of parts) for (const index of part.indices) for (let c = 0; c < 3; c++) {
    bounds.min[c] = Math.min(bounds.min[c], part.positions[index * 3 + c])
    bounds.max[c] = Math.max(bounds.max[c], part.positions[index * 3 + c])
}
const size = bounds.max.map((v, i) => v - bounds.min[i])
const centre = bounds.max.map((v, i) => (v + bounds.min[i]) / 2)
// glTF is Y-up; the car's length runs along whichever horizontal axis is longer.
const lengthAxis = size[0] > size[2] ? 0 : 2
const widthAxis = lengthAxis === 0 ? 2 : 0
// The windscreen sits ahead of the cabin centre, so it tells us which end is the nose.
let glassSum = 0, glassCount = 0
for (const part of parts.filter(part => part.glass)) for (const index of part.indices) {
    glassSum += part.positions[index * 3 + lengthAxis] - centre[lengthAxis]; glassCount++
}
const forwardSign = glassCount && glassSum / glassCount < 0 ? -1 : 1
const scale = CAR_LENGTH / size[lengthAxis]
// Keep a right-handed frame: nose → +Z, so the side axis maps to ±X accordingly.
const sideSign = lengthAxis === 2 ? forwardSign : -forwardSign
const toGame = (x, y, z) => {
    const p = [x, y, z]
    return [
        Math.round((p[widthAxis] - centre[widthAxis]) * scale * sideSign),
        Math.round((p[1] - bounds.min[1]) * scale),
        Math.round((p[lengthAxis] - centre[lengthAxis]) * scale * forwardSign),
    ]
}

// --- Flat-shaded triangles ----------------------------------------------------
// Light from above and slightly in front, like the old hand-built car's shading.
const light = (() => { const v = [0.3, 0.85, 0.45], l = Math.hypot(...v); return v.map(c => c / l) })()
const toSrgb = c => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2))
const out = { opaque: { positions: [], colours: [] }, glass: { positions: [], colours: [] } }
for (const part of parts) {
    const target = part.glass ? out.glass : out.opaque
    for (let t = 0; t < part.indices.length; t += 3) {
        const corners = [0, 1, 2].map(k => part.indices[t + k])
        const p = corners.map(i => toGame(part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]))
        const e1 = p[1].map((v, c) => v - p[0][c]), e2 = p[2].map((v, c) => v - p[0][c])
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        const nl = Math.hypot(...n)
        if (nl === 0) continue
        // Both sides are drawn, so light by the absolute facing.
        const shade = 0.55 + 0.45 * Math.abs(n.reduce((s, v, c) => s + v * light[c], 0) / nl)
        const colour = [0, 1, 2, 3].map(c => corners.reduce((s, i) => s + part.colours[i * 4 + c], 0) / 3)
        target.positions.push(...p.flat())
        target.colours.push(toSrgb(colour[0] * shade), toSrgb(colour[1] * shade), toSrgb(colour[2] * shade),
            part.glass ? Math.round(Math.max(0.35, colour[3]) * 255) : 255)
    }
}

const encode = (values, Type) => Buffer.from(new Type(values).buffer).toString('base64')
const meta = gltf.asset.extras || {}
const source = `// Generated by otherTools/convertCarGlb.mjs from ${path.basename(input)}. Do not edit by hand.
// "${meta.title || 'model'}" by ${meta.author || 'unknown'}, ${meta.license || 'see source'}
// Source: ${meta.source || 'n/a'}
import * as Gbi from "../../include/gbi"

// Base64 → typed array, without relying on atob being available.
const decode = (text, Type) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const clean = text.replace(/=+$/, '')
    const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4))
    for (let i = 0, j = 0; i < clean.length; i += 4) {
        const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, alphabet.indexOf(clean[i + k] || 'A')), 0)
        for (let k = 0; k < 3 && j < bytes.length; k++) bytes[j++] = (n >> (16 - k * 8)) & 255
    }
    return new Type(bytes.buffer)
}

// Triangles as Int16 corner positions (x, y, z) and one RGBA colour each,
// loaded 21 at a time into the 64-entry vertex buffer.
const build = (positionText, colourText) => {
    const positions = decode(positionText, Int16Array), colours = decode(colourText, Uint8Array)
    const commands = []
    const triangles = positions.length / 9
    for (let first = 0; first < triangles; first += 21) {
        const batch = Math.min(21, triangles - first), vertices = []
        for (let t = 0; t < batch; t++) {
            const colour = Array.from(colours.subarray((first + t) * 4, (first + t) * 4 + 4))
            for (let k = 0; k < 3; k++) {
                const i = ((first + t) * 3 + k) * 3
                vertices.push([[positions[i], positions[i + 1], positions[i + 2]], 0, [0, 0], colour])
            }
        }
        commands.push(Gbi.gsSPVertex(vertices, vertices.length, 0))
        for (let t = 0; t < batch; t++) commands.push(Gbi.gsSP1Triangle(t * 3, t * 3 + 1, t * 3 + 2, 0))
    }
    return [
        Gbi.gsDPPipeSync(),
        Gbi.gsDPSetCombineMode(Gbi.G_CC_SHADE),
        Gbi.gsSPTexture(0, 0, 0, Gbi.G_TX_RENDERTILE, Gbi.G_OFF),
        Gbi.gsSPClearGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
        ...commands,
        Gbi.gsSPSetGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
        Gbi.gsSPEndDisplayList(),
    ].flat()
}

export const CAR_MODEL_SIZE = ${JSON.stringify({
        length: CAR_LENGTH,
        width: Math.round(size[widthAxis] * scale),
        height: Math.round(size[1] * scale),
        triangles: out.opaque.colours.length / 4 + out.glass.colours.length / 4,
    })}

export const garden_car_dl = build(
    "${encode(out.opaque.positions, Int16Array)}",
    "${encode(out.opaque.colours, Uint8Array)}")

export const garden_car_glass_dl = build(
    "${encode(out.glass.positions, Int16Array)}",
    "${encode(out.glass.colours, Uint8Array)}")
`
fs.writeFileSync(output, source)
console.log(`${path.basename(input)}: ${totalTriangles} → ${out.opaque.colours.length / 4} opaque + ${out.glass.colours.length / 4} glass triangles,`,
    `${Math.round(source.length / 1024)} KB, length axis ${'XYZ'[lengthAxis]}, nose ${forwardSign > 0 ? '+' : '-'}, size`,
    JSON.stringify({ length: CAR_LENGTH, width: Math.round(size[widthAxis] * scale), height: Math.round(size[1] * scale) }))
