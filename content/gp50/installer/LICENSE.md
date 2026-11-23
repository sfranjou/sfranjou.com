# License of the firmware installer

The firmware installer (this folder, `web/installer/`, together with `web/lzo/` which it loads) is distributed under
the **GNU General Public License, version 2** (GPL-2.0). Full text:
[`COPYING`](COPYING).

Why: the installer runs miniLZO 2.10 by Markus F.X.J. Oberhumer (GPL version 2 or later; used here under version 2), compiled to WebAssembly
(`web/lzo/lzo_wasm.mjs`). The complete corresponding source of that module is `web/lzo/src/` (unmodified upstream
files: [minilzo.c](../lzo/src/minilzo.c), [minilzo.h](../lzo/src/minilzo.h), [lzoconf.h](../lzo/src/include/lzo/lzoconf.h),
[lzodefs.h](../lzo/src/include/lzo/lzodefs.h), [lzo1x.h](../lzo/src/include/lzo/lzo1x.h), [README.LZO](../lzo/src/README.LZO)),
[shim.c](../lzo/shim.c) and [build.sh](../lzo/build.sh); running `build.sh` with Emscripten reproduces the shipped module.

Our own files in this folder (`index.html`, `patcher.mjs`, `patches/`, `releases.json`) and the shared modules it
imports from `web/gp50/` are also available under the MIT license of the project (`/LICENSE`); the GPL applies to the
installer as a combined program. Everything else in the project (web editor, tone capture, SDK, scripts) is MIT and
does not include or load miniLZO. See `/LICENSING.md`.
