// RenderWare binary streams are nested chunks: type, size and library version,
// each a little-endian uint32, followed by `size` bytes of data.
export const readChunk = (bytes, offset) => {
    const data = new DataView(bytes.buffer, bytes.byteOffset + offset, 12)
    const size = data.getUint32(4, true)
    return { type: data.getUint32(0, true), size, data: offset + 12, end: offset + 12 + size }
}

// The chunks directly inside `parent`.
export const childChunks = (bytes, parent) => {
    const children = []
    for (let offset = parent.data; offset + 12 <= parent.end;) {
        const chunk = readChunk(bytes, offset)
        children.push(chunk)
        offset = chunk.end
    }
    return children
}
