// LZO1X-1 in the browser (miniLZO 2.10 compiled to WebAssembly; GPL-2.0-or-later, see build.sh).
import createModule from './lzo_wasm.mjs';

let ready = null;
async function module() {
  ready ??= createModule().then(m => {
    if (m._gp50_lzo_init() !== 0) throw new Error('lzo_init failed');
    return m;
  });
  return ready;
}

function call(m, fn, input, capacity) {
  const src = m._malloc(input.length), dst = m._malloc(capacity), out = m._malloc(4);
  try {
    m.HEAPU8.set(input, src);
    m.HEAPU32[out >> 2] = capacity;
    const r = fn(src, input.length, dst, out);
    if (r !== 0) throw new Error(`lzo error ${r}`);
    return m.HEAPU8.slice(dst, dst + m.HEAPU32[out >> 2]);
  } finally {
    m._free(src); m._free(dst); m._free(out);
  }
}

// Worst-case LZO1X expansion: len + len/16 + 64 + 3.
export async function compress(input) {
  const m = await module();
  return call(m, m._gp50_lzo_compress, input, input.length + (input.length >> 4) + 67);
}

export async function decompress(input, size) {
  const m = await module();
  const out = call(m, m._gp50_lzo_decompress, input, size);
  if (out.length !== size) throw new Error(`lzo size ${out.length}, expected ${size}`);
  return out;
}
