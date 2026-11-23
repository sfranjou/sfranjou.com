# NAM browser build provenance

This adapter uses unmodified NeuralAmpModelerCore at
`1f42f88535884450104b8711d7595019afa0495b` (v0.5.4), Eigen at
`bc3b39870ecb690a623a3f49149a358b95c5781d`, AudioDSPTools at
`0827c6c2fc0deced568536142ea86f189e0b98a1`, and the nlohmann JSON header
vendored by that Core revision. Source archive URLs/hashes are saved in
work/tone_capture/browser_teacher_069/source_manifest.json; fetch_nam069.py
recreates their project-local copies. Source license notices are in licenses/.
Eigen-covered source remains unmodified and available at the pinned source.

The single-thread plain-C/AudioWorklet architecture follows TONE3000's public
neural-amp-modeler-wasm, pinned a6c895049771bacc40c74dfa19369c2ebf75cdb1,
and its credited openDAW architecture. Our teacher.cpp is a separate small
wrapper with explicit raw inference semantics, not the upstream playback policy.
TONE3000's root MIT notice is preserved; its package metadata independently
labels the UI package ISC. We are not bundling its React UI/package.

Built with Homebrew Emscripten 6.0.13 and project-local EM_CACHE.
Emscripten runtime/support code carries its own upstream licensing; see the
installed toolchain LICENSE/AUTHORS for those components. This document records
provenance, not an assertion that all source components share a single license.

Pinned source archives and their SHA256 values accompany the app in
licenses/source-archives.json. Their upstream locations are:

- https://github.com/sdatkinson/NeuralAmpModelerCore
- https://gitlab.com/libeigen/eigen
- https://github.com/sdatkinson/AudioDSPTools
- https://github.com/tone-3000/neural-amp-modeler-wasm

The Emscripten license and authors notices from the installed6.0.13 package are
also retained in licenses/. The source fetch/build scripts live in this project.
