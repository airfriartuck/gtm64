// Read GTA San Andreas PS2 models (.dff clumps). Their geometry is "native":
// DMA chains of VIF unpacks ready for the PS2's vector unit, laid out by
// RenderWare's default PS2 pipeline (see librw's src/ps2/ps2.cpp). Each mesh
// is a triangle strip split into batches that repeat the last two vertices.
import { readChunk, childChunks } from "./renderware"

const CHUNK = { STRUCT: 0x01, STRING: 0x02, EXTENSION: 0x03, TEXTURE: 0x06, MATERIAL: 0x07, MATERIAL_LIST: 0x08,
    FRAME_LIST: 0x0E, GEOMETRY: 0x0F, CLUMP: 0x10, ATOMIC: 0x14, GEOMETRY_LIST: 0x1A, BIN_MESH: 0x50E, NATIVE_DATA: 0x510 }
const GEOMETRY_NATIVE = 0x01000000
const DMA_CNT = 1, DMA_REF = 3, DMA_RET = 6

const child = (bytes, parent, type) => childChunks(bytes, parent).find(chunk => chunk.type === type)
const dataView = (bytes, offset, length) => new DataView(bytes.buffer, bytes.byteOffset + offset, length)
const string = (bytes, chunk) => String.fromCharCode(...bytes.subarray(chunk.data, chunk.data + chunk.size))
    .replace(/\0.*$/s, '')

// Frames: a 3x3 rotation (rows are the right, up and at axes), a position and a parent.
const readFrames = (bytes, list) => {
    const struct = child(bytes, list, CHUNK.STRUCT)
    const count = dataView(bytes, struct.data, 4).getUint32(0, true)
    return Array.from({ length: count }, (_, i) => {
        const data = dataView(bytes, struct.data + 4 + i * 56, 56)
        const value = k => data.getFloat32(k * 4, true)
        return { rotation: [[value(0), value(1), value(2)], [value(3), value(4), value(5)], [value(6), value(7), value(8)]],
            position: [value(9), value(10), value(11)], parent: data.getInt32(48, true) }
    })
}

// A frame's transform into clump space, as a point mapper.
export const frameToClump = (frames, index) => point => {
    let p = point
    for (let i = index; i >= 0; i = frames[i].parent) {
        const { rotation: r, position } = frames[i]
        p = [0, 1, 2].map(axis => position[axis] + p[0] * r[0][axis] + p[1] * r[1][axis] + p[2] * r[2][axis])
    }
    return p
}

const readMaterials = (bytes, list) => childChunks(bytes, list).filter(chunk => chunk.type === CHUNK.MATERIAL)
    .map(material => {
        const struct = child(bytes, material, CHUNK.STRUCT)
        const colour = Array.from(bytes.subarray(struct.data + 4, struct.data + 8))
        const texture = child(bytes, material, CHUNK.TEXTURE)
        const name = texture && child(bytes, texture, CHUNK.STRING)
        return { colour, texture: name ? string(bytes, name).toLowerCase() : null }
    })

// The 32-bit words a DMA chain sends to the VIF, with referenced data inlined.
const vifWords = (bytes, start, size) => {
    const words = []
    const word = offset => dataView(bytes, offset, 4).getUint32(0, true)
    for (let tag = start; tag < start + size;) {
        const head = word(tag), qwc = head & 0xFFFF, id = (head >>> 28) & 7
        words.push(word(tag + 8), word(tag + 12))
        if (id === DMA_REF) {
            const at = start + word(tag + 4) * 16
            for (let i = 0; i < qwc * 4; i++) words.push(word(at + i * 4))
            tag += 16
        } else if (id === DMA_CNT || id === DMA_RET) {
            for (let i = 0; i < qwc * 4; i++) words.push(word(tag + 16 + i * 4))
            tag += 16 + qwc * 16
            if (id === DMA_RET) break
        } else {
            throw new Error(`Unsupported DMA tag ${id}`)
        }
    }
    return words
}

// Unpack one batch attribute: V3-32 positions, V2-32 UVs, V4-8 colours, V3-8 normals.
const UNPACKS = {
    0x68: { name: 'positions', count: 3, read: (data, at) => data.getFloat32(at, true), size: 4 },
    0x64: { name: 'uvs', count: 2, read: (data, at) => data.getFloat32(at, true), size: 4 },
    0x6E: { name: 'colours', count: 4, read: (data, at) => data.getUint8(at), size: 1 },
    0x6A: { name: 'normals', count: 3, read: (data, at) => data.getInt8(at) / 127, size: 1 },
}

// Vertices in strip order: batches are joined by dropping each batch's
// two-vertex overlap with the next.
const readStrip = words => {
    const strip = { positions: [], uvs: [], colours: [], normals: [] }
    const buffer = new DataView(new Uint32Array(words).buffer)
    let batchCount = 0
    for (let i = 0; i < words.length;) {
        const code = words[i], command = (code >>> 24) & 0x7F
        if ((command & 0x60) !== 0x60) {
            // STMASK takes one word, STROW/STCOL four, DIRECT a qword count.
            i += 1 + (command === 0x20 ? 1 : command === 0x30 || command === 0x31 ? 4
                : command === 0x50 || command === 0x51 ? (code & 0xFFFF) * 4 : 0)
            continue
        }
        const components = ((command >> 2) & 3) + 1, bits = 32 >> (command & 3), num = (code >>> 16) & 0xFF
        const words32 = Math.ceil(num * components * bits / 8 / 4)
        const unpack = UNPACKS[command & 0x6F]
        if (unpack) {
            const values = strip[unpack.name]
            if (unpack.name === 'positions') {
                // A new batch repeats the previous batch's last two vertices.
                if (batchCount++ > 0) for (const list of Object.values(strip)) list.length -= 2
            }
            for (let v = 0; v < num; v++) {
                const vertex = []
                for (let c = 0; c < unpack.count; c++) vertex.push(unpack.read(buffer, (i + 1) * 4 + (v * unpack.count + c) * unpack.size))
                values.push(vertex)
            }
        }
        i += 1 + words32
    }
    return strip
}

// Strip to triangles, skipping the degenerate ones that join strips.
const stripTriangles = count => {
    const triangles = []
    for (let i = 2; i < count; i++) {
        const tri = i % 2 ? [i - 1, i - 2, i] : [i - 2, i - 1, i]
        triangles.push(tri)
    }
    return triangles
}

const samePosition = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

const readGeometry = (bytes, geometry) => {
    const struct = child(bytes, geometry, CHUNK.STRUCT)
    const flags = dataView(bytes, struct.data, 4).getUint32(0, true)
    if (!(flags & GEOMETRY_NATIVE)) throw new Error('Expected PS2 native geometry')
    const materials = readMaterials(bytes, child(bytes, geometry, CHUNK.MATERIAL_LIST))
    const extension = child(bytes, geometry, CHUNK.EXTENSION)
    const binMesh = child(bytes, extension, CHUNK.BIN_MESH)
    const native = child(bytes, extension, CHUNK.NATIVE_DATA)
    const meshData = dataView(bytes, binMesh.data, 12)
    const meshCount = meshData.getUint32(4, true)
    const meshMaterials = []
    for (let i = 0, at = binMesh.data + 12; i < meshCount; i++) {
        const header = dataView(bytes, at, 8)
        meshMaterials.push(header.getUint32(4, true))
        at += 8 + header.getUint32(0, true) * 4
    }
    // The native struct's own size is unreliable in SA's files; walk the meshes.
    let at = native.data + 12 + 4
    return meshMaterials.map(materialIndex => {
        const header = dataView(bytes, at, 8)
        const size = header.getUint32(0, true)
        const strip = readStrip(vifWords(bytes, at + 8, size))
        at += 8 + size
        const triangles = stripTriangles(strip.positions.length).filter(([a, b, c]) =>
            !samePosition(strip.positions[a], strip.positions[b]) && !samePosition(strip.positions[b], strip.positions[c])
            && !samePosition(strip.positions[a], strip.positions[c]))
        return { material: materials[materialIndex], ...strip, triangles }
    })
}

// A clump's atomics: their meshes and the frame each hangs from.
export const readClump = bytes => {
    const clump = readChunk(bytes, 0)
    if (clump.type !== CHUNK.CLUMP) throw new Error('Not a RenderWare clump')
    const frames = readFrames(bytes, child(bytes, clump, CHUNK.FRAME_LIST))
    const geometries = childChunks(bytes, child(bytes, clump, CHUNK.GEOMETRY_LIST))
        .filter(chunk => chunk.type === CHUNK.GEOMETRY).map(geometry => readGeometry(bytes, geometry))
    const atomics = childChunks(bytes, clump).filter(chunk => chunk.type === CHUNK.ATOMIC).map(atomic => {
        const data = dataView(bytes, child(bytes, atomic, CHUNK.STRUCT).data, 8)
        return { frame: data.getUint32(0, true), meshes: geometries[data.getUint32(4, true)] }
    })
    return { frames, atomics }
}
