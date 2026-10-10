# Original SM64 audio

Audio source and required headers from
https://github.com/libsm64/libsm64 at commit
`fd11813208272b4271d92bd92feb8f3fdbe61be5`, under the included CC0 license.
The upstream audio engine derives from the SM64 decompilation project.

Only the audio engine, sample mixer, bank converter and platform shims are
compiled. Gameplay and graphics continue to run in the JavaScript port.
`audio_bridge.c` adapts the original sound request queue and stereo PCM output.
`audio.js` is the checked-in WebAssembly module and its generated loader; it
contains no ROM data and makes no network requests.

To rebuild, install and activate the official Emscripten SDK **3.1.64**, then run
from this directory:

```sh
python3 build.py /path/to/emsdk/upstream/emscripten/emcc
```

Regular `npm start` and `npm run build` use the precompiled module and do not
require Emscripten. The browser supplies the original US ROM's audio region,
`0x57B720..0x7CC6C1`, to the loader's expected addresses in a temporary ROM
buffer. Output is original interleaved signed 16-bit stereo PCM at 32 kHz.
Web Audio resamples it to the browser's output rate.
