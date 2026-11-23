/* Thin exports for the browser patcher: init check, LZO1X-1 compress and safe decompress. */
#include "minilzo.h"
static lzo_align_t work[(LZO1X_1_MEM_COMPRESS+sizeof(lzo_align_t)-1)/sizeof(lzo_align_t)];
int gp50_lzo_init(void) { return lzo_init(); }
int gp50_lzo_compress(const unsigned char *src, unsigned len, unsigned char *dst, unsigned *out) {
    lzo_uint n = 0; int r = lzo1x_1_compress(src, len, dst, &n, work); *out = (unsigned)n; return r;
}
int gp50_lzo_decompress(const unsigned char *src, unsigned len, unsigned char *dst, unsigned *out) {
    lzo_uint n = *out; int r = lzo1x_decompress_safe(src, len, dst, &n, 0); *out = (unsigned)n; return r;
}
