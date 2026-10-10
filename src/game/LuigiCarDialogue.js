import { originalAudio } from '../audio/OriginalAudio'
import enterVoice from '../audio/luigi/enter.mp3'
import impactVoice from '../audio/luigi/impact.mp3'
import { SOUND_MARIO_HERE_WE_GO, SOUND_MARIO_WHOA, SOUND_MARIO_HAHA, SOUND_MARIO_YAHOO } from '../include/sounds'

const lines = {
    enter: ["All right, brother. You drive. I'll watch for trouble.", SOUND_MARIO_HERE_WE_GO],
    impact: ["That's a wall, genius. We're casing the castle, not demolishing it.", SOUND_MARIO_WHOA],
    speed: ["Easy, Mario! This is a getaway, not a damn cannon launch.", SOUND_MARIO_YAHOO],
    turn: ["You got a license for this thing, or did you steal that too?", SOUND_MARIO_WHOA],
    hill: ["Keep it steady. I'm not rolling downhill for your insurance money.", SOUND_MARIO_WHOA],
    reverse: ["Backing out? Finally, a plan I can respect.", SOUND_MARIO_HAHA],
    idle: ["Move it, brother. We look suspicious just sitting here.", SOUND_MARIO_HAHA],
    cruise: ["No stars, no witnesses. Let's keep it that way.", SOUND_MARIO_HAHA],
}

const recordedVoices = { enter: enterVoice, impact: impactVoice }

export class LuigiCarDialogue {
    constructor(audio = originalAudio) {
        this.audio = audio
        this.generation = 0
        this.lastLine = null
        this.lastSpoken = -Infinity
        this.previousSpeed = 0
    }

    clear() {
        this.generation++
        if (this.subtitle) this.subtitle.hidden = true
        if (this.voice) { this.voice.stop(); this.voice = null }
        this.car = null
        this.previousSpeed = 0
    }

    say(key, now) {
        if (!this.subtitle) {
            this.subtitle = document.createElement('div')
            this.subtitle.id = 'luigi-car-subtitle'
            this.subtitle.setAttribute('role', 'status')
            this.subtitle.setAttribute('aria-live', 'polite')
            this.subtitle.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:1001;padding:10px 16px;border-radius:8px;background:rgba(0,0,0,.8);color:white;font:18px sans-serif;text-align:center;max-width:80vw;pointer-events:none'
            document.body.appendChild(this.subtitle)
        }
        const [text, sound] = lines[key]
        this.subtitle.textContent = 'Luigi: ' + text
        this.subtitle.hidden = false
        this.expires = now + 5
        this.lastSpoken = now
        this.lastLine = key
        const generation = ++this.generation
        if (this.voice) { this.voice.stop(); this.voice = null }
        const current = () => this.generation === generation
        const playback = recordedVoices[key]
            ? this.audio.playDialogueClip(recordedVoices[key], current)
            : this.audio.playPassengerVoice(sound, current)
        playback
            .then(source => {
                if (current()) {
                    this.voice = source
                    if (source && source.buffer) this.expires = Math.max(this.expires, now + source.buffer.duration + 0.5)
                } else if (source) source.stop()
            })
            .catch(error => console.error('Luigi voice unavailable:', error))
    }

    update(car, now, input = {}) {
        if (!car || !car.driving || document.hidden) {
            if (this.car) this.clear()
            return
        }
        if (car !== this.car) {
            this.clear()
            this.car = car
            this.say('enter', now)
        } else {
            if (now >= this.expires && this.subtitle) this.subtitle.hidden = true
            if (now - this.lastSpoken >= 10) {
                let key
                if (this.previousSpeed > 25 && car.speed === 0 && !input.buttonDownA && !input.buttonDownZ) key = 'impact'
                else if (Math.abs(car.pitch || 0) > 1800 && Math.abs(car.speed) > 10) key = 'hill'
                else if (Math.abs(input.stickX || 0) > 40 && car.speed > 35) key = 'turn'
                else if (car.speed > 60) key = 'speed'
                else if (car.speed < -15) key = 'reverse'
                else if (Math.abs(car.speed) < 1) key = 'idle'
                else if (now - this.lastSpoken > 20) key = 'cruise'
                if (key && key !== this.lastLine) this.say(key, now)
            }
        }
        this.previousSpeed = car.speed
    }
}

export const luigiCarDialogue = new LuigiCarDialogue()
