import createSM64Audio from "../../vendor/libsm64-audio/audio"

export const AUDIO_ROM_START = 0x57B720
export const AUDIO_ROM_END = 0x7CC6C1
const SAMPLE_RATE = 32000
const origin = [0, 0, 0]

// libsm64 runs the original sequencer and sample mixer. Only the audio region
// of the user's ROM is cached; the rest of this temporary buffer stays zero.
export class OriginalAudio {
    constructor(factory = createSM64Audio) {
        this.factory = factory
        this.sources = new Set()
        this.sounds = new Map()
        this.soundSlots = new Map()
        this.nextTime = 0
        this.muted = false
    }

    prepare(data) {
        if (this.ready) return this.ready
        this.ready = (async () => {
            if (!data || data.length !== AUDIO_ROM_END - AUDIO_ROM_START) throw new Error('Please reload your US ROM to enable original audio.')
            const engine = await this.factory()
            const pointer = engine._malloc(0x800000)
            try {
                engine.HEAPU8.fill(0, pointer, pointer + 0x800000)
                engine.HEAPU8.set(data, pointer + AUDIO_ROM_START)
                engine._sm64js_audio_init(pointer)
            } finally {
                engine._free(pointer)
            }
            this.engine = engine
            this.romAudioData = data
        })()
        // Keep a failed initialization handled even before the Start button.
        this.ready.catch(error => { this.error = error; console.error('Original audio:', error) })
        return this.ready
    }

    async unlock() {
        if (!this.context) {
            const AudioContext = window.AudioContext || window.webkitAudioContext
            if (!AudioContext) return
            this.context = new AudioContext()
            this.gain = this.context.createGain()
            this.gain.gain.value = this.muted ? 0 : 0.7
            this.gain.connect(this.context.destination)
        }
        if (this.context.state === 'suspended') await this.context.resume()
    }

    setMuted(muted) {
        this.muted = muted
        if (this.gain) this.gain.gain.setValueAtTime(muted ? 0 : 0.7, this.context.currentTime)
    }

    pause() {
        this.sounds.clear()
        for (const source of this.sources) { source.stop(); source.disconnect() }
        this.sources.clear()
        this.nextTime = 0
        if (this.context) this.context.suspend().catch(() => {})
    }

    call(name, ...args) {
        if (this.engine) this.engine['_' + name](...args)
    }

    // Render passenger reactions independently so pitching Luigi never changes
    // Mario's voice or the soundtrack. Cache only the handful of requested clips.
    async playPassengerVoice(bits, isCurrent = () => true) {
        if (!this.romAudioData || !this.context || this.context.state !== 'running') return
        if (!this.voiceEngine) {
            this.voiceEngine = (async () => {
                const engine = await this.factory()
                const pointer = engine._malloc(0x800000)
                try {
                    engine.HEAPU8.fill(0, pointer, pointer + 0x800000)
                    engine.HEAPU8.set(this.romAudioData, pointer + AUDIO_ROM_START)
                    engine._sm64js_audio_init(pointer)
                } finally { engine._free(pointer) }
                return engine
            })()
            this.voiceBuffers = new Map()
        }
        if (!this.voiceBuffers.has(bits)) {
            // Serialize renders: all clips share the isolated native mixer.
            const render = (this.voiceRender || Promise.resolve()).then(async () => {
                const engine = await this.voiceEngine
                engine._sound_reset(0)
                engine._sm64js_play_sound(bits, 0, 0, 0, 0)
                const chunks = []
                let frames = 0
                for (let tick = 0; tick < 60; tick++) {
                    const count = engine._sm64js_audio_tick(0)
                    if (!count) break
                    const start = engine._sm64js_audio_buffer() >> 1
                    chunks.push(engine.HEAP16.slice(start, start + count * 2))
                    frames += count
                    if (tick % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0))
                }
                if (!frames) return null
                const buffer = this.context.createBuffer(2, frames, SAMPLE_RATE)
                let offset = 0
                for (const chunk of chunks) {
                    for (let channel = 0; channel < 2; channel++) {
                        const output = buffer.getChannelData(channel)
                        for (let i = 0; i < chunk.length / 2; i++) output[offset + i] = chunk[i * 2 + channel] / 32768
                    }
                    offset += chunk.length / 2
                }
                return buffer
            })
            this.voiceRender = render.catch(() => {})
            this.voiceBuffers.set(bits, render)
        }
        const buffer = await this.voiceBuffers.get(bits)
        if (!buffer || !isCurrent() || document.hidden || this.context.state !== 'running') return
        const source = this.context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = 1.18
        source.connect(this.gain)
        source.onended = () => { this.sources.delete(source); source.disconnect() }
        this.sources.add(source)
        source.start()
        return source
    }

    // Recorded dialogue shares the game's audio context, volume and pause lifecycle.
    async playDialogueClip(url, isCurrent = () => true) {
        if (!this.context || this.context.state !== 'running' || !isCurrent() || document.hidden) return
        if (!this.dialogueBuffers) this.dialogueBuffers = new Map()
        if (!this.dialogueBuffers.has(url)) {
            const loading = fetch(url).then(response => {
                if (!response.ok) throw new Error(`Dialogue audio HTTP ${response.status}`)
                return response.arrayBuffer()
            }).then(data => this.context.decodeAudioData(data))
            this.dialogueBuffers.set(url, loading)
            loading.catch(() => { this.dialogueBuffers.delete(url) })
        }
        const buffer = await this.dialogueBuffers.get(url)
        if (!isCurrent() || document.hidden || this.context.state !== 'running') return
        const source = this.context.createBufferSource()
        source.buffer = buffer
        source.connect(this.gain)
        source.onended = () => { this.sources.delete(source); source.disconnect() }
        this.sources.add(source)
        source.start()
        return source
    }

    playSound(bits, position = origin) {
        if (!this.engine || !this.context || this.context.state !== 'running') return
        const bank = bits >>> 28
        if (bank >= 10) return
        const priority = (bits >>> 8) & 255
        const now = this.context.currentTime
        let source = this.soundSlots.get(position)
        if (!source) {
            let slot = this.soundSlots.size
            if (slot === 128) {
                let oldest
                for (const entry of this.soundSlots) {
                    if (!oldest || entry[1].lastUsed < oldest[1].lastUsed) oldest = entry
                }
                // Reuse only inactive sources; the native queue retains pointers.
                if (now - oldest[1].lastUsed < 1) return
                slot = oldest[1].slot
                this.soundSlots.delete(oldest[0])
            }
            source = { slot, lastUsed: now }
            this.soundSlots.set(position, source)
        }
        source.lastUsed = now
        const key = bank * 128 + source.slot
        const pos = [0, 1, 2].map(i => Number.isFinite(position[i]) ? position[i] : 0)
        const previous = this.sounds.get(key)
        // Preserve source identity. The original driver chooses which source
        // wins a bank; unrelated birds must not replace one another's loops.
        if (!previous || priority >= previous.priority || now - previous.requested > 0.1) {
            this.sounds.set(key, { bits, pos, priority, slot: source.slot, requested: now })
        }
    }

    update(area) {
        if (!this.engine || !this.context || this.context.state !== 'running' || document.hidden) {
            this.sounds.clear()
            return
        }
        if (area !== this.area) {
            this.area = area
            this.call('sound_reset', area ? area.musicParam : 0)
            if (area) {
                const sequence = area.musicParam2 || (!this.openingPlayed ? this.openingMusic : 0)
                if (sequence) this.call('play_music', 0, (4 << 8) | sequence, 0)
                this.openingPlayed = true
            }
        }
        const now = this.context.currentTime
        this.nextTime = Math.max(this.nextTime, now + 0.01)
        // Bound catch-up work and latency; animation frames can stall or run
        // twice without changing the audio engine's 32 kHz clock.
        for (let tick = 0; tick < 4 && this.nextTime < now + 0.1; tick++) {
            let requests = 0
            for (const [key, sound] of this.sounds) {
                if (now - sound.requested > 0.1) { this.sounds.delete(key); continue }
                if (requests++ === 128) break
                this.call('sm64js_play_sound', sound.bits, ...sound.pos, sound.slot)
                // Discrete sounds play once. Refresh loops on every native
                // tick, including the extra buffers generated for look-ahead.
                if (sound.bits & 0x80) this.sounds.delete(key)
            }
            const frames = this.engine._sm64js_audio_tick(Math.round((this.nextTime - now) * SAMPLE_RATE))
            if (!frames) break
            const pcm = this.engine._sm64js_audio_buffer() >> 1
            const buffer = this.context.createBuffer(2, frames, SAMPLE_RATE)
            for (let channel = 0; channel < 2; channel++) {
                const output = buffer.getChannelData(channel)
                for (let i = 0; i < frames; i++) output[i] = this.engine.HEAP16[pcm + i * 2 + channel] / 32768
            }
            const source = this.context.createBufferSource()
            source.buffer = buffer
            source.connect(this.gain)
            source.onended = () => { this.sources.delete(source); source.disconnect() }
            this.sources.add(source)
            source.start(this.nextTime)
            this.nextTime += frames / SAMPLE_RATE
        }
    }
}

export const originalAudio = new OriginalAudio()
