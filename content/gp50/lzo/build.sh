#!/bin/bash
# Build web/lzo/lzo_wasm.mjs from upstream miniLZO 2.10 (GPL-2.0-or-later). The unmodified upstream files it needs
# are in web/lzo/src/ (copied from lzo-2.10.tar.gz, sha256 c0f89294...a072, `brew fetch --build-from-source lzo`), so
# the published site carries the complete corresponding source of the WebAssembly module.
set -euo pipefail
cd "$(dirname "$0")"
SRC=src
emcc -O2 -I"$SRC" -I"$SRC/include" -I"$SRC/include/lzo" "$SRC/minilzo.c" shim.c -o lzo_wasm.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_gp50_lzo_init,_gp50_lzo_compress,_gp50_lzo_decompress \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32
