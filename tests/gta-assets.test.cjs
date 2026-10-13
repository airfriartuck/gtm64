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
// read the gun files from it.
test('reading Mario\'s gun files from a GTA San Andreas disc image', { skip: !process.env.GTA_SA_ISO }, async () => {
    const { load } = runtime({ DataView, String })
    const { extractGtaAssets, GTA_WEAPON_MODELS } = load('gta/gtaAssets.js')
    const handle = fs.openSync(process.env.GTA_SA_ISO, 'r')
    const read = async (offset, length) => {
        const bytes = Buffer.alloc(length)
        fs.readSync(handle, bytes, 0, length, offset)
        return new Uint8Array(bytes.buffer, bytes.byteOffset, length)
    }
    const { files } = await extractGtaAssets(read)
    fs.closeSync(handle)
    for (const model of Object.values(GTA_WEAPON_MODELS)) {
        assert.equal(Buffer.from(files[`${model}.dff`]).readUInt32LE(0), 0x10, `${model}.dff is a RenderWare clump`)
        assert.equal(Buffer.from(files[`${model}.txd`]).readUInt32LE(0), 0x16, `${model}.txd is a texture dictionary`)
    }
})
