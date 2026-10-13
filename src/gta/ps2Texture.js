// Decode GTA San Andreas PS2 texture dictionaries (.txd) into RGBA pixels.
// The layout follows librw's PS2 raster code (src/ps2/ps2raster.cpp): each
// texture is a palettised GS upload, with GIF packet headers before the pixels
// and the palette, and pixels swizzled for faster uploads.
import { readChunk, childChunks } from "./renderware"

const CHUNK_STRUCT = 0x01, CHUNK_STRING = 0x02, CHUNK_TEXTURE_NATIVE = 0x15
const GIF_HEADER = 0x50
const PAL8 = 0x2000, PAL4 = 0x4000, FORMAT_MASK = 0xF00, C8888 = 0x500

const string = (bytes, chunk) => String.fromCharCode(...bytes.subarray(chunk.data, chunk.data + chunk.size))
    .replace(/\0.*$/s, '')

// librw's swizzle(): where pixel (x, y) of a 4-row strip sits once the GS has
// stored it as PSMCT32 (8-bit) or PSMCT16 (4-bit) pixels.
const swizzle = (x, y, logw) => {
    const bit = (value, n) => (value >> n) & 1
    x ^= (bit(y, 1) ^ bit(y, 2)) << 2
    const nx = (x & 7) | ((x >> 1) & ~7)
    const ny = (y & 1) | ((y >> 1) & ~1)
    const n = bit(y, 1) | (bit(x, 3) << 1)
    return n | (nx << 2) | (ny << (logw - 1 + 2))
}

// Unswizzled palette indices, one byte per pixel.
const unswizzle = (pixels, width, height, depth) => {
    const minW = depth === 4 ? 32 : 16, minH = 4
    const w = Math.max(width, minW), h = Math.max(height, minH)
    let logw = 0
    for (let i = 1; i < w; i *= 2) logw++
    const mask = (1 << (logw + 2)) - 1
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y += 4) {
        const strip = depth === 4 ? pixels.subarray((y * w) >> 1, ((y + 4) * w) >> 1)
            : pixels.subarray(y * w, (y + 4) * w)
        for (let i = 0; i < 4; i++) {
            for (let x = 0; x < w; x++) {
                const s = swizzle(x, y + i, logw) & mask
                out[(y + i) * w + x] = depth === 4 ? (s & 1 ? strip[s >> 1] >> 4 : strip[s >> 1] & 0xF) : strip[s]
            }
        }
    }
    return { indices: out, stride: w }
}

// PS2 alpha runs 0..0x80; 8-bit palettes swap index bits 3 and 4 (CSM1).
const readPalette = (bytes, start, count) => {
    const palette = []
    for (let i = 0; i < count; i++) {
        const at = start + i * 4
        palette.push([bytes[at], bytes[at + 1], bytes[at + 2], Math.min(255, bytes[at + 3] * 2)])
    }
    if (count === 256) {
        for (let i = 0; i < 256; i++) {
            if ((i & 0x18) === 0x10) [palette[i], palette[i ^ 0x18]] = [palette[i ^ 0x18], palette[i]]
        }
    }
    return palette
}

const decodeRaster = (bytes, raster) => {
    const header = readChunk(bytes, raster.data)
    const data = new DataView(bytes.buffer, bytes.byteOffset + header.data, 64)
    const width = data.getUint32(0, true), height = data.getUint32(4, true), depth = data.getUint32(8, true)
    const format = data.getUint16(12, true), version = data.getInt16(14, true)
    const pixelSize = data.getUint32(48, true)
    const body = readChunk(bytes, header.data + header.size)
    if (version < 2) throw new Error('Unsupported PS2 texture version')
    const rgba = new Uint8Array(width * height * 4)
    if (format & (PAL4 | PAL8)) {
        const pixelBytes = bytes.subarray(body.data + GIF_HEADER, body.data + pixelSize)
        const { indices, stride } = unswizzle(pixelBytes, width, height, depth)
        if ((format & FORMAT_MASK) !== C8888) throw new Error('Unsupported PS2 palette format')
        const palette = readPalette(bytes, body.data + pixelSize + GIF_HEADER, depth === 4 ? 16 : 256)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) rgba.set(palette[indices[y * stride + x]], (y * width + x) * 4)
        }
    } else if (depth === 32) {
        const start = body.data + GIF_HEADER
        for (let i = 0; i < width * height; i++) {
            rgba.set([bytes[start + i * 4], bytes[start + i * 4 + 1], bytes[start + i * 4 + 2],
                Math.min(255, bytes[start + i * 4 + 3] * 2)], i * 4)
        }
    } else {
        throw new Error(`Unsupported PS2 texture depth ${depth}`)
    }
    return { width, height, rgba }
}

// Every texture in a .txd, by lower-case name.
export const readTextureDictionary = bytes => {
    const textures = new Map()
    const dictionary = readChunk(bytes, 0)
    for (const native of childChunks(bytes, dictionary)) {
        if (native.type !== CHUNK_TEXTURE_NATIVE) continue
        const [platform, name, , raster] = childChunks(bytes, native)
        if (platform.type !== CHUNK_STRUCT || name.type !== CHUNK_STRING) continue
        textures.set(string(bytes, name).toLowerCase(), decodeRaster(bytes, raster))
    }
    return textures
}
