const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// A minimal Web Audio stand-in that records the node graph.
function fakeAudio() {
    const nodes = []
    const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { this.events.push(['set', v, t]) },
        exponentialRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]) } })
    const node = (kind, extra = {}) => {
        const n = { kind, outputs: [], connect(target) { n.outputs.push(target); return target }, disconnect() { n.disconnected = true }, ...extra }
        nodes.push(n)
        return n
    }
    const context = {
        state: 'running', currentTime: 5, sampleRate: 8000,
        createGain: () => node('gain', { gain: param() }),
        createBiquadFilter: () => node('filter', { frequency: param(), type: '' }),
        createOscillator: () => node('osc', { frequency: param(), stops: [], start(t) { this.started = t }, stop(t) { this.stops.push(t) } }),
        createBufferSource: () => node('noise', { start(t, offset, duration) { this.started = t; this.duration = duration },
            stops: [], stop(t) { this.stops.push(t) } }),
        createBuffer: (channels, length, rate) => ({ sampleRate: rate, length, data: new Float32Array(length), getChannelData() { return this.data } }),
    }
    const master = node('master', { gain: param() })
    return { audio: { context, gain: master, sources: new Set() }, nodes, master, context }
}

function load(document = { hidden: false }) {
    const filename = path.resolve(__dirname, '../src/audio/GunSounds.js')
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code
    const module = { exports: {} }
    const context = vm.createContext({ Math, document, Float32Array })
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(() => ({}), module, module.exports)
    return module.exports
}

// Follow outputs to see whether a node reaches the game's master gain.
const reaches = (node, target, seen = new Set()) => node === target
    || (!seen.has(node) && (seen.add(node), node.outputs.some(next => reaches(next, target, seen))))

test('every gun has its own synthesized shot routed through the game volume', () => {
    const { GUN_SOUNDS, playGunSound } = load()
    const signatures = new Set()
    for (const id of ['pistol', 'deagle', 'shotgun', 'smg', 'm4', 'sniper']) {
        const { audio, master, context } = fakeAudio()
        const sources = playGunSound(audio, id)
        assert.ok(sources.length >= 2, `${id} has a crack and a thump`)
        assert.ok(sources.every(source => reaches(source, master)), `${id} plays through the master gain`)
        assert.ok(sources.every(source => source.started >= context.currentTime))
        assert.equal(audio.sources.size, sources.length, 'tracked so pause() can stop it')
        sources[0].onended()
        assert.equal(audio.sources.size, sources.length - 1)
        signatures.add(JSON.stringify(GUN_SOUNDS[id]))
    }
    assert.equal(signatures.size, 6, 'no two guns sound the same')
    // Heavy guns ring out longer than light ones; pump and bolt guns add clicks.
    const length = id => Math.max(GUN_SOUNDS[id].crack[1], GUN_SOUNDS[id].thump[2])
    assert.ok(length('sniper') > length('pistol') && length('shotgun') > length('smg'))
    assert.ok(GUN_SOUNDS.shotgun.clicks.length && GUN_SOUNDS.sniper.clicks.length)
    for (const id of ['reload', 'ready', 'empty', 'switch']) {
        const { audio, master } = fakeAudio()
        assert.ok(playGunSound(audio, id).every(source => reaches(source, master)), id)
    }
})

test('gun sounds stay silent while audio is locked, paused or the tab is hidden', () => {
    const { playGunSound } = load()
    const { audio } = fakeAudio()
    audio.context.state = 'suspended'
    assert.equal(playGunSound(audio, 'pistol'), null)
    assert.equal(playGunSound({ context: null }, 'pistol'), null)
    assert.equal(playGunSound(fakeAudio().audio, 'no-such-gun'), null)
    const hidden = load({ hidden: true })
    assert.equal(hidden.playGunSound(fakeAudio().audio, 'pistol'), null)
})

test('automatic fire is capped so overlapping shots never pile up', () => {
    const { playGunSound } = load()
    const { audio } = fakeAudio()
    const first = playGunSound(audio, 'smg')
    for (let i = 0; i < 16; i++) playGunSound(audio, 'smg')
    assert.equal(audio.gunVoices.length, 16)
    // The oldest shot is cut short: every one of its sources gets an immediate stop().
    assert.ok(first.every(source => source.stops.includes(undefined)), 'the oldest shot is cut')
    assert.ok(audio.gunVoices.every(group => group !== first))
})
