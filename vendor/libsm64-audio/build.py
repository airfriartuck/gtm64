"""Build with Emscripten 3.1.64: python3 build.py /path/to/emcc."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
sources = [root / 'audio_bridge.c', root / 'src/load_audio_data.c', root / 'src/debug_print.c']
for directory in ['audio', 'pc', 'tools']:
    sources.extend(sorted((root / 'src/decomp' / directory).glob('*.c')))
exports = ['malloc', 'free', 'sm64js_audio_init', 'sm64js_audio_tick', 'sm64js_audio_buffer',
           'sm64js_play_sound', 'play_music', 'play_secondary_music', 'func_80321080',
           'play_puzzle_jingle', 'set_sound_moving_speed', 'seq_player_play_sequence',
           'seq_player_lower_volume', 'seq_player_unlower_volume', 'seq_player_fade_out',
           'stop_background_music', 'fadeout_background_music', 'func_803210D4',
           'get_current_background_music', 'sound_reset']
subprocess.run([sys.argv[1] if len(sys.argv) > 1 else 'emcc', *map(str, sources),
    '-O2', '-fno-strict-aliasing', '-Wno-incompatible-pointer-types', '-Wno-pointer-sign',
    '-DVERSION_US', '-DNO_SEGMENTED_MEMORY', '-I' + str(root / 'src/decomp/include'),
    '-sMODULARIZE=1', '-sEXPORT_NAME=createSM64Audio', '-sENVIRONMENT=web', '-sSINGLE_FILE=1',
    '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
    '-sEXPORTED_FUNCTIONS=' + str(['_' + name for name in exports]),
    '-o', str(root / 'audio.js')], check=True)
