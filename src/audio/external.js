import { originalAudio } from "./OriginalAudio"

export const SEQ_PLAYER_LEVEL = 0
export const SEQ_PLAYER_ENV = 1
export const SEQ_PLAYER_SFX = 2
export const SEQUENCE_ARGS = (priority, seqId) => (priority << 8) | seqId
export const gGlobalSoundSource = [0, 0, 0]

export const play_sound = (soundBits, pos) => originalAudio.playSound(soundBits, pos)
export const play_music = (player, seqArgs, fadeTimer) => originalAudio.call('play_music', player, seqArgs, fadeTimer)
export const play_secondary_music = (seqId, bgMusicVolume, volume, fadeTimer) => originalAudio.call('play_secondary_music', seqId, bgMusicVolume, volume, fadeTimer)
export const func_80321080 = fadeTimer => originalAudio.call('func_80321080', fadeTimer)
export const play_puzzle_jingle = () => originalAudio.call('play_puzzle_jingle')
export const set_sound_moving_speed = (bank, speed) => originalAudio.call('set_sound_moving_speed', bank, speed)
export const seq_player_play_sequence = (player, seqId, arg2) => originalAudio.call('seq_player_play_sequence', player, seqId, arg2)
export const seq_player_lower_volume = (player, fadeDuration, percentage) => originalAudio.call('seq_player_lower_volume', player, fadeDuration, percentage)
export const seq_player_unlower_volume = (player, fadeDuration) => originalAudio.call('seq_player_unlower_volume', player, fadeDuration)
