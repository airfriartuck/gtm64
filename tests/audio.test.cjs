const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

function runtime() {
    const contexts = []
    class AudioContext {
        constructor() { this.state = 'suspended'; this.currentTime = 0; this.nodes = []; contexts.push(this) }
        async resume() { this.state = 'running' }
        async suspend() { this.state = 'suspended' }
        createGain() { return { gain: { value: 1, setValueAtTime(v) { this.value = v } }, connect() {} } }
        createBuffer(channels, frames, rate) {
            const data = Array.from({ length: channels }, () => new Float32Array(frames))
            return { data, sampleRate: rate, getChannelData: i => data[i] }
        }
        createBufferSource() {
            const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(time) { this.time = time }, stop() { this.stopped = true } }
            this.nodes.push(node)
            return node
        }
    }
    const calls = []
    const memory = new ArrayBuffer(32 * 1024 * 1024)
    const methods = {
        HEAPU8: new Uint8Array(memory), HEAP16: new Int16Array(memory),
        _malloc: () => 16, _free: pointer => calls.push(['free', pointer]),
        _sm64js_audio_init: pointer => calls.push(['init', pointer]),
        _sm64js_audio_tick: () => 1088,
        _sm64js_audio_buffer: () => 0,
    }
    const engine = new Proxy(methods, { get: (object, name) => name === 'then' ? undefined : object[name] || ((...args) => calls.push([name, ...args])) })
    const context = vm.createContext({ window: { AudioContext }, document: { hidden: false },
        setTimeout, console: { error() {} }, require: () => ({ default: async () => engine }), exports: {} })
    const filename = path.resolve(__dirname, '../src/audio/OriginalAudio.js')
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code
    vm.runInContext(code, context)
    const api = context.exports
    const audio = new api.OriginalAudio(async () => engine)
    return { audio, engine, calls, contexts, context, api }
}

test('compiled original engine loads and exposes ROM decoding, effects and music', async () => {
    const engine = await require('../vendor/libsm64-audio/audio.js')()
    assert.equal(engine._sm64js_audio_tick(0), 0)
    for (const method of ['_sm64js_audio_init', '_sm64js_play_sound', '_play_music', '_play_puzzle_jingle', '_sound_reset']) {
        assert.equal(typeof engine[method], 'function')
    }
})

test('loads only the cached ROM audio region, frees temporary memory and initializes once', async () => {
    const r = runtime()
    const data = new Uint8Array(r.api.AUDIO_ROM_END - r.api.AUDIO_ROM_START).fill(17)
    await r.audio.prepare(data)
    await r.audio.prepare(data)
    assert.equal(r.engine.HEAPU8[16 + r.api.AUDIO_ROM_START], 17)
    assert.equal(r.engine.HEAPU8[16 + r.api.AUDIO_ROM_END - 1], 17)
    assert.equal(r.engine.HEAPU8[16], 0)
    assert.equal(r.engine.HEAPU8[16 + r.api.AUDIO_ROM_END], 0)
    assert.deepEqual(r.calls, [['init',16], ['free',16]])
    const bad = runtime()
    await assert.rejects(bad.audio.prepare(new Uint8Array(10)), /reload your US ROM/)
    assert.equal(bad.audio.engine, undefined)
})

test('schedules original stereo PCM at 32 kHz with bounded latency and starts area music once', async () => {
    const r = runtime()
    r.audio.engine = r.engine
    await r.audio.unlock()
    const context = r.contexts[0]
    r.engine.HEAP16[0] = 32767
    r.engine.HEAP16[1] = -32768
    const area = { musicParam: 1, musicParam2: 4 }
    r.audio.update(area)
    assert.equal(context.nodes.length, 3)
    assert.equal(context.nodes[0].buffer.sampleRate, 32000)
    assert.equal(context.nodes[0].buffer.data[0][0], 32767 / 32768)
    assert.equal(context.nodes[0].buffer.data[1][0], -1)
    assert.deepEqual(r.calls, [['_sound_reset',1], ['_play_music',0,1028,0]])
    r.audio.update(area)
    assert.equal(context.nodes.length, 3)
    assert.equal(r.calls.length, 2)
    context.currentTime = 10
    r.audio.update(area)
    assert.ok(context.nodes.at(-1).time >= 10 && context.nodes.at(-1).time < 10.11)
    r.audio.update({ musicParam: 0, musicParam2: 0 })
    assert.deepEqual(r.calls.at(-1), ['_sound_reset',0])
})

test('selects priority per source and retains no muted-tab backlog', async () => {
    const r = runtime()
    r.audio.engine = r.engine
    await r.audio.unlock()
    const area = { musicParam: 0, musicParam2: 0 }
    r.audio.update(area)
    r.calls.length = 0
    const source = [0,0,0]
    r.audio.playSound(0x30011080, source)
    source[0] = 100
    r.audio.playSound(0x30022080, source)
    source[0] = 20
    r.audio.playSound(0x30032080, source)
    r.audio.playSound(0xF001FF80, [0,0,0])
    r.contexts[0].currentTime = 0.034
    r.audio.update(area)
    assert.deepEqual(r.calls, [['_sm64js_play_sound',0x30032080,20,0,0,0]])
    r.audio.playSound(0x30011080)
    r.audio.pause()
    assert.equal(r.audio.sources.size, 0)
    assert.equal(r.audio.sounds.size, 0)
    assert.ok(r.contexts[0].nodes.every(node => node.stopped))
    r.audio.setMuted(true)
    assert.equal(r.audio.gain.gain.value, 0)
    await r.audio.unlock()
    r.calls.length = 0
    r.audio.update(area)
    assert.deepEqual(r.calls, [])
    r.audio.setMuted(false)
    assert.equal(r.audio.gain.gain.value, 0.7)
})

test('outdoor loops have independent sources and refresh for every look-ahead buffer', async () => {
    const r = runtime()
    r.audio.engine = r.engine
    await r.audio.unlock()
    const bird1 = [10,0,0], bird2 = [100,0,0]
    r.audio.playSound(0x50514001, bird1)
    r.audio.playSound(0x50514001, bird2)
    r.audio.update({ musicParam: 0, musicParam2: 0 })
    const emitted = r.calls.filter(call => call[0] === '_sm64js_play_sound')
    assert.equal(emitted.length, 6)
    assert.deepEqual(emitted.map(call => call.at(-1)), [0,1,0,1,0,1])
    r.calls.length = 0
    r.contexts[0].currentTime = 0.034
    bird1[0] = 20
    r.audio.playSound(0x50514001, bird1)
    r.audio.update(r.audio.area)
    assert.equal(r.calls[0].at(-1), 0)
    assert.equal(r.calls[0][2], 20)
    r.contexts[0].currentTime = 0.3
    r.calls.length = 0
    r.audio.update(r.audio.area)
    assert.equal(r.audio.sounds.size, 0)
    assert.equal(r.calls.length, 0)
})

test('opening title music plays once and yields to the next area soundtrack', async () => {
    const r = runtime()
    r.audio.engine = r.engine
    await r.audio.unlock()
    r.audio.openingMusic = 2
    const grounds = { musicParam: 0, musicParam2: 0 }
    r.audio.update(grounds)
    assert.ok(r.calls.some(call => call[0] === '_play_music' && call[2] === 1026))
    r.calls.length = 0
    r.audio.update(grounds)
    assert.equal(r.calls.length, 0)
    r.audio.update({ musicParam: 1, musicParam2: 4 })
    assert.ok(r.calls.some(call => call[0] === '_play_music' && call[2] === 1028))
    r.calls.length = 0
    r.audio.update(grounds)
    assert.deepEqual(r.calls, [['_sound_reset',0]])
})


test('passenger voice uses an isolated mixer, caches clips and cancels stale playback', async () => {
    const r = runtime()
    await r.audio.prepare(new Uint8Array(r.api.AUDIO_ROM_END - r.api.AUDIO_ROM_START))
    await r.audio.unlock()
    let mixers = 0
    r.audio.factory = async () => { mixers++; return r.engine }
    const bits = 0x240C8081
    assert.equal(await r.audio.playPassengerVoice(bits, () => false), undefined)
    assert.equal(r.contexts[0].nodes.length, 0)
    const voice = await r.audio.playPassengerVoice(bits)
    assert.equal(mixers, 1)
    assert.equal(voice.playbackRate.value, 1.18)
    assert.equal(voice.buffer.sampleRate, 32000)
    assert.ok(r.audio.sources.has(voice))
    assert.equal(r.calls.filter(call => call[0] === '_sm64js_play_sound').length, 1)
    r.audio.pause()
    assert.equal(voice.stopped, true)
})

test('recorded dialogue caches decoded audio, cancels delayed speech and shares mute and pause', async () => {
    const r = runtime()
    await r.audio.unlock()
    const context = r.contexts[0]
    let requests = 0, decodes = 0, finish
    r.context.fetch = async () => {
        requests++
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    }
    context.decodeAudioData = () => {
        decodes++
        return new Promise(resolve => { finish = resolve })
    }
    let current = true
    const pending = r.audio.playDialogueClip('/enter.mp3', () => current)
    await new Promise(resolve => setImmediate(resolve))
    current = false
    finish({ duration: 3.12 })
    assert.equal(await pending, undefined)
    assert.equal(context.nodes.length, 0)
    const source = await r.audio.playDialogueClip('/enter.mp3')
    assert.equal(requests, 1)
    assert.equal(decodes, 1)
    assert.equal(source.playbackRate.value, 1)
    assert.equal(source.buffer.duration, 3.12)
    assert.ok(r.audio.sources.has(source))
    r.audio.setMuted(true)
    assert.equal(r.audio.gain.gain.value, 0)
    r.audio.pause()
    assert.equal(source.stopped, true)
    assert.equal(await r.audio.playDialogueClip('/enter.mp3'), undefined)
})

test('failed recorded dialogue downloads can load again and hidden tabs never start speech', async () => {
    const r = runtime()
    await r.audio.unlock()
    r.context.fetch = async () => ({ ok: false, status: 404 })
    await assert.rejects(r.audio.playDialogueClip('/missing.mp3'), /HTTP 404/)
    assert.equal(r.audio.dialogueBuffers.size, 0)
    r.context.document.hidden = true
    assert.equal(await r.audio.playDialogueClip('/enter.mp3'), undefined)
    assert.equal(r.contexts[0].nodes.length, 0)
})
