// Read files out of the GTA San Andreas PS2 disc without loading all of it:
// `read(offset, length)` resolves to a Uint8Array of that byte range (a slice
// of the user's .iso File in the browser, a file handle in tests).

const SECTOR = 2048
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end))
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

// ISO 9660 directory records: length, extent sector and size, flags, then the
// name ("GTA3.IMG;1", or a single 0/1 byte for "." and "..").
const directoryEntries = bytes => {
    const data = view(bytes), entries = []
    for (let offset = 0; offset < bytes.length;) {
        const length = bytes[offset]
        if (length === 0) {
            // Records never cross a sector; the rest of this one is padding.
            offset = (Math.floor(offset / SECTOR) + 1) * SECTOR
            continue
        }
        const nameLength = bytes[offset + 32]
        entries.push({
            name: ascii(bytes, offset + 33, offset + 33 + nameLength).replace(/;\d+$/, '').replace(/\.$/, ''),
            offset: data.getUint32(offset + 2, true) * SECTOR,
            size: data.getUint32(offset + 10, true),
            directory: Boolean(bytes[offset + 25] & 2),
        })
        offset += length
    }
    return entries
}

// Find a file on the disc by its path, e.g. "MODELS/GTA3.IMG".
export const findIsoFile = async (read, path) => {
    const volume = await read(16 * SECTOR, SECTOR)
    if (volume[0] !== 1 || ascii(volume, 1, 6) !== 'CD001') throw new Error('This is not a PS2 disc image (.iso)')
    let entry = { offset: view(volume).getUint32(156 + 2, true) * SECTOR,
        size: view(volume).getUint32(156 + 10, true), directory: true }
    for (const part of path.toUpperCase().split('/')) {
        if (!entry.directory) return null
        entry = directoryEntries(await read(entry.offset, entry.size)).find(child => child.name === part)
        if (!entry) return null
    }
    return entry
}

// GTA SA's VER2 .img archive: a count, then 32-byte entries of sector offset,
// size in sectors and a 24-byte name. Names are matched case-insensitively.
export const readImgDirectory = async (read, base) => {
    const header = await read(base, 8)
    if (ascii(header, 0, 4) !== 'VER2') throw new Error('Unexpected GTA3.IMG format')
    const count = view(header).getUint32(4, true)
    const bytes = await read(base + 8, count * 32), data = view(bytes)
    const files = new Map()
    for (let i = 0; i < count; i++) {
        const at = i * 32
        const name = ascii(bytes, at + 8, at + 32).replace(/\0.*$/, '').toLowerCase()
        files.set(name, { offset: base + data.getUint32(at, true) * SECTOR, size: data.getUint16(at + 4, true) * SECTOR })
    }
    return files
}
