// Assets taken from the player's GTA San Andreas PS2 disc image: each gun's
// model and HUD icon. Like the SM64 ROM, they can't be hosted, so the player
// selects their .iso once; only the few files needed are read from it, and
// the decoded results are kept in IndexedDB.
import * as IDB from "idb-keyval"
import { findIsoFile, readImgDirectory } from "./archives"
import { readTextureDictionary } from "./ps2Texture"
import { readClump, frameToClump } from "./ps2Model"

const msgpack = require("msgpack-lite")

const STORAGE_KEY = 'gtaAssets'
const ASSET_VERSION = 3

// Mario's weapons (Weapons.js ids) and the SA model each one uses.
export const GTA_WEAPON_MODELS = {
    pistol: 'colt45',
    deagle: 'desert_eagle',
    shotgun: 'chromegun',
    smg: 'micro_uzi',
    m4: 'm4',
    sniper: 'sniper',
}

const MUZZLE_TEXTURE = 'muzzle_texture4'

export const gtaAssets = { weapons: {} }
const listeners = []
export const onGtaAssetsLoaded = listener => listeners.push(listener)

// One gun: the body's meshes in model space (not the muzzle flash atomic),
// its textures, its HUD icon and where its barrel ends.
const extractWeapon = (name, dff, txd) => {
    const textures = readTextureDictionary(txd)
    const clump = readClump(dff)
    const isFlash = atomic => atomic.meshes.every(mesh => mesh.material.texture === MUZZLE_TEXTURE)
    const body = clump.atomics.find(atomic => !isFlash(atomic))
    const toModel = frameToClump(clump.frames, body.frame)
    const meshes = body.meshes.map(mesh => ({
        texture: mesh.material.texture,
        positions: mesh.positions.map(toModel),
        uvs: mesh.uvs,
        normals: mesh.normals,
        triangles: mesh.triangles,
    }))
    const points = meshes.flatMap(mesh => mesh.positions)
    const extent = axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]
    const [, frontX] = extent(0)
    const tip = points.filter(p => p[0] >= frontX - 0.02)
    const average = axis => tip.reduce((sum, p) => sum + p[axis], 0) / tip.length
    const usedTextures = Object.fromEntries([...new Set(meshes.map(mesh => mesh.texture))]
        .map(texture => [texture, textures.get(texture)]))
    const icon = [...textures].find(([textureName]) => textureName.endsWith('icon'))
    if (!icon) throw new Error(`${name} has no HUD icon`)
    return {
        meshes, textures: usedTextures, icon: icon[1],
        centreY: average(1),
        muzzle: [frontX, average(1), average(2)],
    }
}

// Read the guns from the disc. `read(offset, length)` returns its bytes.
export const extractGtaAssets = async read => {
    const img = await findIsoFile(read, 'MODELS/GTA3.IMG')
    if (!img) throw new Error("This disc image doesn't contain GTA San Andreas (MODELS/GTA3.IMG is missing)")
    const files = await readImgDirectory(read, img.offset)
    const readEntry = async name => {
        const entry = files.get(name)
        if (!entry) throw new Error(`GTA3.IMG is missing ${name}`)
        return read(entry.offset, entry.size)
    }
    const weapons = {}
    for (const [id, model] of Object.entries(GTA_WEAPON_MODELS)) {
        weapons[id] = extractWeapon(model, await readEntry(`${model}.dff`), await readEntry(`${model}.txd`))
    }
    // Fists have no model; their icon is in the HUD's own dictionary.
    const hud = await findIsoFile(read, 'MODELS/HUD.TXD')
    if (!hud) throw new Error('This disc image is missing MODELS/HUD.TXD')
    const fist = readTextureDictionary(await read(hud.offset, hud.size)).get('fist')
    if (!fist) throw new Error('HUD.TXD has no fist icon')
    weapons.fist = { meshes: [], textures: {}, icon: fist }
    return { version: ASSET_VERSION, weapons }
}

const useAssets = data => {
    gtaAssets.weapons = data.weapons
    listeners.forEach(listener => listener(gtaAssets))
}

const weaponTextures = weapon => [weapon.icon, ...Object.values(weapon.textures)]

// Pixels are stored as plain arrays, which msgpack round-trips everywhere.
const storable = data => ({ ...data, weapons: Object.fromEntries(Object.entries(data.weapons).map(([id, weapon]) => [id, {
    ...weapon,
    icon: { ...weapon.icon, rgba: Array.from(weapon.icon.rgba) },
    textures: Object.fromEntries(Object.entries(weapon.textures).map(([name, texture]) =>
        [name, { ...texture, rgba: Array.from(texture.rgba) }])),
}])) })

const restoreTextures = data => {
    for (const weapon of Object.values(data.weapons)) {
        for (const texture of weaponTextures(weapon)) texture.rgba = new Uint8Array(texture.rgba)
    }
    return data
}

// Load previously extracted assets. Resolves true when they're available.
export const checkForGtaAssets = async () => {
    const stored = await IDB.get(STORAGE_KEY)
    if (!stored) return false
    const data = msgpack.decode(stored)
    if (data.version !== ASSET_VERSION) return false
    useAssets(restoreTextures(data))
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
