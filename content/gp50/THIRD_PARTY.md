# Third-party notices

## GP-50 preset code adapted from `drewmerc302/valeton-gp50`

`gp50/prst.mjs` adapts `app/static/prst.js` from
[drewmerc302/valeton-gp50](https://github.com/drewmerc302/valeton-gp50), vendored commit `aadcf9b`.
`gp50/presets.mjs` uses its documented preset-write payload and validation approach.
The editor adopts the Explorer workflow (presets, chain, block detail, capture bank); its UI is newly written.
The captured factory blank is omitted from this port. No firmware or factory audio is bundled.

MIT License

Copyright (c) 2026 Andrew Mercurio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## LZO (firmware installer)

`web/lzo/lzo_wasm.mjs` is miniLZO 2.10 by Markus F.X.J. Oberhumer, compiled to WebAssembly with Emscripten
(`web/lzo/build.sh`, plus the small `web/lzo/shim.c`). License: GNU GPL version 2 or later; full text in
`web/lzo/COPYING`. Source: the official lzo-2.10.tar.gz (sha256 c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072,
fetched with `brew fetch --build-from-source lzo`); the files the module is built from are copied unmodified to
`web/lzo/src/`, and `build.sh` reproduces the shipped module byte for byte from them (checked 2026-11-06). The installer
is therefore distributed under GPL-2.0 (`web/installer/LICENSE.md`); the rest of the site is MIT.

## Browser trainer

- jax-js (MIT): `trainer/vendor/jax/LICENSE`
- NAM player and its parts: `trainer/THIRD_PARTY.md`, `trainer/licenses/`

## Live audio demo

- WebAssembly toolchain notices: `audio/licenses/`

## Captures

- `captures/files/*.lttc`: our own trained files
- Trained from NAM captures on TONE3000 (T3K license); original authors and links: `captures/captures.json`
- No NAM file is included
