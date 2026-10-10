#include <stdint.h>
#include "src/load_audio_data.h"
#include "src/decomp/audio/external.h"

static int16_t samples[544 * 2 * 2];
static float positions[128][3];
void play_sound(uint32_t bits, float *pos) {
    if (!g_is_audio_initialized) return;
    sSoundRequests[sSoundRequestCount].soundBits = bits;
    sSoundRequests[sSoundRequestCount].position = pos;
    sSoundRequestCount++;
}

void sm64js_audio_init(const uint8_t *rom) {
    if (!g_is_audio_initialized) load_audio_banks(rom);
}

uint32_t sm64js_audio_tick(uint32_t queued) {
    if (!g_is_audio_initialized) return 0;
    update_game_sound();
    uint32_t count = queued < 1100 ? 544 : 528;
    create_next_audio_buffer(samples, count);
    create_next_audio_buffer(samples + count * 2, count);
    return count * 2;
}

int16_t *sm64js_audio_buffer(void) { return samples; }

void sm64js_play_sound(uint32_t bits, float x, float y, float z, uint32_t source) {
    uint32_t bank = bits >> 28;
    if (!g_is_audio_initialized || bank >= 10 || source >= 128) return;
    positions[source][0] = x;
    positions[source][1] = y;
    positions[source][2] = z;
    play_sound(bits, positions[source]);
}
