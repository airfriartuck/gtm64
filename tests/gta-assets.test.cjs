const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// Load game modules through babel; npm packages (idb-keyval, msgpack-lite) are stubbed.
function runtime(globals = {}) {
    const root = path.resolve(__dirname, '../src')
    const context = vm.createContext({ gLinker: {}, console, Math, ...globals })
    const cache = new Map()
    const load = relative => {
        const filename = path.resolve(root, relative)
        if (cache.has(filename)) return cache.get(filename).exports
        const module = { exports: {} }
        cache.set(filename, module)
        const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
            filename, babelrc: false, configFile: false,
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        }).code
        vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(
            request => request.startsWith('.')
                ? load(path.relative(root, path.resolve(path.dirname(filename), `${request}.js`)))
                : {},
            module, module.exports)
        return module.exports
    }
    return { load }
}

const SECTOR = 2048
const readerFor = bytes => async (offset, length) => bytes.slice(offset, offset + length)

// A directory record: extent sector, size, flags and name.
const record = (sector, size, name, directory) => {
    const nameBytes = typeof name === 'string' ? Buffer.from(name, 'latin1') : Buffer.from(name)
    const length = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0)
    const bytes = Buffer.alloc(length)
    bytes[0] = length
    bytes.writeUInt32LE(sector, 2)
    bytes.writeUInt32LE(size, 10)
    bytes[25] = directory ? 2 : 0
    bytes[32] = nameBytes.length
    nameBytes.copy(bytes, 33)
    return bytes
}

// A tiny disc: /MODELS/GTA3.IMG holding colt45.dff at sector 2 of the archive.
const fakeDisc = () => {
    const disc = Buffer.alloc(24 * SECTOR)
    disc[16 * SECTOR] = 1
    disc.write('CD001', 16 * SECTOR + 1, 'latin1')
    record(18, SECTOR, [0], true).copy(disc, 16 * SECTOR + 156)
    Buffer.concat([record(18, SECTOR, [0], true), record(18, SECTOR, [1], true), record(19, SECTOR, 'MODELS', true)])
        .copy(disc, 18 * SECTOR)
    Buffer.concat([record(19, SECTOR, [0], true), record(18, SECTOR, [1], true), record(20, 4 * SECTOR, 'GTA3.IMG;1', false)])
        .copy(disc, 19 * SECTOR)
    const img = 20 * SECTOR
    disc.write('VER2', img, 'latin1')
    disc.writeUInt32LE(1, img + 4)
    disc.writeUInt32LE(2, img + 8)
    disc.writeUInt16LE(1, img + 12)
    disc.write('COLT45.DFF', img + 16, 'latin1')
    return new Uint8Array(disc)
}

test('the disc reader finds GTA3.IMG and the files inside it', async () => {
    const { findIsoFile, readImgDirectory } = runtime({ DataView, String }).load('gta/archives.js')
    const read = readerFor(fakeDisc())
    const img = await findIsoFile(read, 'models/gta3.img')
    assert.equal(img.offset, 20 * SECTOR)
    assert.equal(await findIsoFile(read, 'MODELS/GTA3_MISSING.IMG'), null)
    const files = await readImgDirectory(read, img.offset)
    assert.deepEqual({ ...files.get('colt45.dff') }, { offset: 22 * SECTOR, size: SECTOR })
    await assert.rejects(findIsoFile(readerFor(new Uint8Array(20 * SECTOR)), 'MODELS/GTA3.IMG'), /not a PS2 disc image/)
})

test('PS2 textures read 8-bit palettes in CSM1 order and double PS2 alpha', () => {
    const { readTextureDictionary } = runtime({ DataView, String }).load('gta/ps2Texture.js')
    const chunk = (type, ...parts) => {
        const body = Buffer.concat(parts)
        const header = Buffer.alloc(12)
        header.writeUInt32LE(type, 0)
        header.writeUInt32LE(body.length, 4)
        header.writeUInt32LE(0x1803FFFF, 8)
        return Buffer.concat([header, body])
    }
    const width = 16, height = 4, gif = Buffer.alloc(0x50)
    const pixels = Buffer.concat([gif, Buffer.alloc(width * height, 0x10)])
    const palette = Buffer.alloc(256 * 4)
    // Index 0x10 is stored in slot 0x08 under CSM1.
    palette.set([10, 20, 30, 0x80], 0x08 * 4)
    const header = Buffer.alloc(64)
    header.writeUInt32LE(width, 0)
    header.writeUInt32LE(height, 4)
    header.writeUInt32LE(8, 8)
    header.writeUInt16LE(0x2504, 12) // PAL8 | C8888 | texture
    header.writeInt16LE(2, 14)
    header.writeUInt32LE(pixels.length, 48)
    const platform = Buffer.alloc(8)
    platform.write('PS2\0', 0, 'latin1')
    const txd = chunk(0x16, chunk(1, Buffer.from([1, 0, 0, 0])), chunk(0x15,
        chunk(1, platform), chunk(2, Buffer.from('gun\0', 'latin1')), chunk(2, Buffer.from('\0\0\0\0')),
        chunk(1, chunk(1, header), chunk(1, pixels, gif, palette))))
    const texture = readTextureDictionary(new Uint8Array(txd)).get('gun')
    assert.equal(texture.width, 16)
    assert.deepEqual(Array.from(texture.rgba.subarray(0, 4)), [10, 20, 30, 255])
    assert.deepEqual(Array.from(texture.rgba.subarray(-4)), [10, 20, 30, 255])
})

test('GTA guns become textured hand-space display lists with the muzzle at the barrel tip', () => {
    const { load } = runtime()
    const Gbi = load('include/gbi.js')
    const { installGtaGuns, mario_gun_dls } = load('actors/mario_gun/model.inc.js')
    const texture = { width: 2, height: 2, rgba: new Uint8Array(16) }
    installGtaGuns({ pistol: {
        meshes: [{ texture: 'gun', positions: [[0, 0, 0], [0.3, 0, 0.1], [0, 0, 0.1]], uvs: [[0, 0], [1, 0], [0, 1]],
            normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]], triangles: [[0, 1, 2]] }],
        textures: { gun: texture }, icon: texture, centreY: 0, muzzle: [0.3, 0, 0.1],
    } })
    const gun = mario_gun_dls.pistol
    assert.equal(gun.muzzle[0], 45 + 0.3 * 700, 'barrel tip, forward of the grip')
    assert.equal(gun.muzzle[1], 70, 'model Z is hand-space height')
    const image = gun.dl.find(command => command.words.w0 === Gbi.G_SETTIMG)
    assert.equal(image.words.w1.size, Gbi.G_IM_SIZ_32b)
    assert.equal(image.words.w1.imageData, texture.rgba)
    const vertices = gun.dl.find(command => command.words.w0 === Gbi.G_VTX).words.w1.vertices
    assert.deepEqual([...vertices[1][0]], [45 + 210, 70, 0])
    assert.deepEqual([...vertices[1][2]], [64, 0], 'UVs are 10.5 fixed-point texels')
    assert.deepEqual([...vertices[1][3].slice(0, 3)], [0, 127, 0], 'model up is hand-space up for lighting')
    assert.ok(gun.flashDl.length > gun.dl.length, 'firing adds the flash')
})

test('Start unlocks only once both the SM64 ROM and the GTA disc are loaded', () => {
    const button = { disabled: true }
    const { load } = runtime({ document: { getElementById: () => button } })
    const requirements = load('gameRequirements.js')
    requirements.requirementMet('gta')
    assert.equal(button.disabled, true)
    requirements.requirementMet('rom')
    assert.equal(button.disabled, false)
    assert.equal(requirements.allRequirementsMet(), true)
})

// With a GTA San Andreas PS2 disc image available (GTA_SA_ISO=/path/to.iso),
// extract the real guns.
test('extracting Mario\'s guns from a GTA San Andreas disc image', { skip: !process.env.GTA_SA_ISO }, async () => {
    const { load } = runtime({ DataView, String, Uint32Array, Set })
    const { extractGtaAssets, GTA_WEAPON_MODELS } = load('gta/gtaAssets.js')
    const handle = fs.openSync(process.env.GTA_SA_ISO, 'r')
    const read = async (offset, length) => {
        const bytes = Buffer.alloc(length)
        fs.readSync(handle, bytes, 0, length, offset)
        return new Uint8Array(bytes.buffer, bytes.byteOffset, length)
    }
    const { weapons } = await extractGtaAssets(read)
    fs.closeSync(handle)
    assert.deepEqual(Object.keys(weapons), [...Object.keys(GTA_WEAPON_MODELS), 'fist'])
    assert.equal(weapons.fist.icon.width, 64, 'the fist icon comes from HUD.TXD')
    for (const [id, weapon] of Object.entries(weapons).filter(([id]) => id !== 'fist')) {
        assert.equal(weapon.icon.width, 64, id)
        assert.equal(weapon.icon.rgba[3], 0, `${id} icon has a transparent corner`)
        assert.ok(weapon.meshes.reduce((n, mesh) => n + mesh.triangles.length, 0) > 100, `${id} has a real model`)
        const front = Math.max(...weapon.meshes.flatMap(mesh => mesh.positions.map(p => p[0])))
        assert.equal(weapon.muzzle[0], front, `${id} fires from the barrel tip`)
        for (const mesh of weapon.meshes) assert.ok(weapon.textures[mesh.texture].rgba.length > 0, `${id} is textured`)
    }
})
