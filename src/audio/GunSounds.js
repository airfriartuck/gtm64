// Synthesized gun sounds. SM64's ROM has no gunfire, so each gun is built from
// a filtered noise crack, a falling low "thump" for body and, for the heavy
// guns, an echo tail, plus mechanical clicks for pumps, bolts and reloads.
// Everything plays through the game's own audio context and master gain, so
// the mute button, pausing and hidden tabs work exactly as for ROM audio.

// crack: noise lowpass cutoff (Hz) and decay (s); thump: start/end pitch and
// decay; echo: delay (s) and feedback; clicks: mechanical sounds after the shot.
export const GUN_SOUNDS = {
    pistol:  { gain: 0.8, crack: [3600, 0.24], thump: [170, 60, 0.15] },
    deagle:  { gain: 1.0, crack: [2400, 0.26], thump: [120, 40, 0.18], echo: [0.12, 0.25] },
    shotgun: { gain: 1.0, crack: [1700, 0.38], thump: [95, 35, 0.24], echo: [0.14, 0.3],
        clicks: [[0.42, 2600, 0.5], [0.56, 1900, 0.6]] },               // pump back, pump forward
    smg:     { gain: 0.6, crack: [4800, 0.14], thump: [210, 90, 0.09] },
    m4:      { gain: 0.7, crack: [3200, 0.18], thump: [150, 60, 0.12] },
    sniper:  { gain: 1.0, crack: [3000, 0.22], thump: [85, 30, 0.3], echo: [0.24, 0.4],
        clicks: [[0.5, 2200, 0.5], [0.66, 2800, 0.45]] },               // bolt up and back, bolt home
    reload:  { gain: 0.6, clicks: [[0, 2000, 0.6], [0.32, 2600, 0.7]] }, // magazine out, magazine in
    ready:   { gain: 0.6, clicks: [[0, 3000, 0.7]] },                   // slide / charging handle
    empty:   { gain: 0.5, clicks: [[0, 4200, 0.5]] },                   // dry fire
    switch:  { gain: 0.5, clicks: [[0, 1500, 0.5], [0.07, 2400, 0.4]] },
}

const MAX_VOICES = 16
let noiseBuffer

const noise = context => {
    if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer
    const length = Math.floor(context.sampleRate * 1.0)
    noiseBuffer = context.createBuffer(1, length, context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    return noiseBuffer
}

// Exponential decay from `peak` to silence starting at `at`.
const envelope = (context, at, peak, decay) => {
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    return gain
}

export const playGunSound = (audio, name) => {
    const recipe = GUN_SOUNDS[name]
    const context = audio && audio.context
    if (!recipe || !context || !audio.gain || context.state !== 'running'
        || (typeof document !== 'undefined' && document.hidden)) return null
    const now = context.currentTime
    const sources = []
    const out = context.createGain()
    out.gain.value = recipe.gain
    out.connect(audio.gain)

    const burst = (at, cutoff, decay, peak, type = 'lowpass') => {
        const source = context.createBufferSource()
        source.buffer = noise(context)
        const filter = context.createBiquadFilter()
        filter.type = type
        filter.frequency.value = cutoff
        const gain = envelope(context, at, peak, decay)
        source.connect(filter).connect(gain).connect(out)
        source.start(at, Math.random() * 0.3, decay + 0.05)
        sources.push(source)
    }

    // Crack and thump peaks together stay under full scale before the master gain.
    if (recipe.crack) burst(now, recipe.crack[0], recipe.crack[1], 0.55)
    if (recipe.thump) {
        const [from, to, decay] = recipe.thump
        const osc = context.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(from, now)
        osc.frequency.exponentialRampToValueAtTime(to, now + decay)
        osc.connect(envelope(context, now, 0.45, decay)).connect(out)
        osc.start(now)
        osc.stop(now + decay + 0.05)
        sources.push(osc)
    }
    if (recipe.echo) {
        // A muffled repeat of the crack, as if off nearby hills.
        const [delay, feedback] = recipe.echo
        burst(now + delay, recipe.crack[0] * 0.5, recipe.crack[1] * 1.5, feedback * 0.55)
        burst(now + delay * 2.2, recipe.crack[0] * 0.35, recipe.crack[1] * 2, feedback * 0.3)
    }
    for (const [at, cutoff, peak] of recipe.clicks || []) burst(now + at, cutoff, 0.035, peak, 'bandpass')

    // Track sources so OriginalAudio.pause() stops them; cap rapid automatic fire.
    for (const source of sources) {
        audio.sources.add(source)
        source.onended = () => { audio.sources.delete(source); source.disconnect() }
    }
    audio.gunVoices = (audio.gunVoices || []).concat([sources])
    while (audio.gunVoices.length > MAX_VOICES) {
        for (const source of audio.gunVoices.shift()) {
            try { source.stop() } catch (error) { /* already finished */ }
        }
    }
    return sources
}
