// Assets taken from the player's GTA San Andreas PS2 disc image. Like the SM64
// ROM, they can't be hosted, so the player selects their .iso once; only the
// few files needed are read from it, and they are kept in IndexedDB.
import * as IDB from "idb-keyval"
import { findIsoFile, readImgDirectory } from "./archives"

const msgpack = require("msgpack-lite")

const STORAGE_KEY = 'gtaAssets'
const ASSET_VERSION = 1

// Mario's weapons (Weapons.js ids) and the SA model each one uses.
export const GTA_WEAPON_MODELS = {
    pistol: 'colt45',
    deagle: 'desert_eagle',
    shotgun: 'chromegun',
    smg: 'micro_uzi',
    m4: 'm4',
    sniper: 'sniper',
}

export const gtaAssets = { files: {} }
const listeners = []
export const onGtaAssetsLoaded = listener => listeners.push(listener)

// Read each gun's model and textures from GTA3.IMG on the disc.
// `read(offset, length)` returns its bytes.
export const extractGtaAssets = async read => {
    const img = await findIsoFile(read, 'MODELS/GTA3.IMG')
    if (!img) throw new Error("This disc image doesn't contain GTA San Andreas (MODELS/GTA3.IMG is missing)")
    const files = await readImgDirectory(read, img.offset)
    const extracted = {}
    for (const model of Object.values(GTA_WEAPON_MODELS)) {
        for (const name of [`${model}.dff`, `${model}.txd`]) {
            const entry = files.get(name)
            if (!entry) throw new Error(`GTA3.IMG is missing ${name}`)
            extracted[name] = await read(entry.offset, entry.size)
        }
    }
    return { version: ASSET_VERSION, files: extracted }
}

const useAssets = data => {
    gtaAssets.files = data.files
    listeners.forEach(listener => listener(gtaAssets))
}

// Bytes are stored as plain arrays, which msgpack round-trips everywhere.
const storable = data => ({ ...data,
    files: Object.fromEntries(Object.entries(data.files).map(([name, bytes]) => [name, Array.from(bytes)])) })
const restore = data => ({ ...data,
    files: Object.fromEntries(Object.entries(data.files).map(([name, bytes]) => [name, new Uint8Array(bytes)])) })

// Load previously extracted assets. Resolves true when they're available.
export const checkForGtaAssets = async () => {
    const stored = await IDB.get(STORAGE_KEY)
    if (!stored) return false
    const data = msgpack.decode(stored)
    if (data.version !== ASSET_VERSION) return false
    useAssets(restore(data))
    return true
}

// Extract from the player's .iso File and keep the result for next time.
export const loadGtaAssetsFromFile = async file => {
    if (/\.(7z|zip|rar)$/i.test(file.name)) {
        throw new Error('Please extract the .iso from the archive first, then select the .iso file')
    }
    const read = async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
    const data = await extractGtaAssets(read)
    await IDB.set(STORAGE_KEY, msgpack.encode(storable(data)))
    useAssets(data)
}
