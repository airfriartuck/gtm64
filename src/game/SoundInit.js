import { originalAudio } from "../audio/OriginalAudio"
import { play_sound, gGlobalSoundSource } from "../audio/external"
import { SOUND_MENU_MARIO_CASTLE_WARP } from "../include/sounds"
import { SEQ_EVENT_POWERUP, SEQ_EVENT_METAL_CAP, SEQ_VARIATION } from "../include/seq_ids"

export const raise_background_noise = (a) => {}
export const play_infinite_stairs_music = () => {}
export const stop_shell_music = () => originalAudio.call('stop_background_music', SEQ_EVENT_POWERUP | SEQ_VARIATION)
export const stop_cap_music = () => {
    originalAudio.call('stop_background_music', SEQ_EVENT_POWERUP)
    originalAudio.call('stop_background_music', SEQ_EVENT_METAL_CAP)
}
export const fadeout_cap_music = () => {
    originalAudio.call('fadeout_background_music', SEQ_EVENT_POWERUP, 600)
    originalAudio.call('fadeout_background_music', SEQ_EVENT_METAL_CAP, 600)
}
export const fadeout_music = fadeOutTime => originalAudio.call('func_803210D4', fadeOutTime)
export const play_painting_eject_sound = () => play_sound(SOUND_MENU_MARIO_CASTLE_WARP, gGlobalSoundSource)
