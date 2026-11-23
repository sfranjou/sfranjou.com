# Licensing overview

Paths are relative to the site folder (`site/` in the repository; `web/` in the development tree).

| Part | License | Notes |
| --- | --- | --- |
| Everything not listed below (SDK, our firmware C, scripts, web editor, tone capture, `gp50/` API) | MIT (`LICENSE`) | |
| Firmware installer: `installer/` + `lzo/` | GPL-2.0 (`installer/LICENSE.md`, `COPYING`) | It runs miniLZO (GPL). Our files inside are also MIT individually; the installer as a whole is GPL. Its LZO source ships in `lzo/src/`. |
| `gp50/prst.mjs` (adapted) | MIT, Andrew Mercurio | notice in `THIRD_PARTY.md` |
| Trainer NAM player (`trainer/browser_teacher/teacher.wasm`) third-party parts | NAM Core MIT, TONE3000 MIT, Eigen MPL-2.0, AudioDSPTools, nlohmann (notices) | `trainer/licenses/` |
| Trainer `trainer/vendor/jax/` (jax-js) | MIT | `trainer/vendor/jax/LICENSE` |
| Captures `captures/files/*.lttc` | MIT (our trained files) | trained from TONE3000 captures (T3K license); credits in `captures/captures.json`; no NAM file included |
| Guitar recordings for the trainer (data service, `trainer/v1/di0–2.flac`) | MIT (our recordings) | fetched by the trainer, not in the repository |
| `firmware/user_effects/clouds_verb/` (repository) | MIT, Emilie Gillet (Mutable Instruments Clouds reverb port) | notice in the source and `sdk/FEATURE_THIRD_PARTY.md` |

Not covered by any of these: Valeton's firmware and anything derived from it. Our MIT license cannot relicense
Valeton material; the public installer serves only our own bytes and builds the image from the user's own stock file.

References: GNU GPL FAQ on combining GPL code with code under a compatible lax license
(https://www.gnu.org/licenses/gpl-faq.html#GPLModuleLicense) and on separate programs distributed together
(https://www.gnu.org/licenses/gpl-faq.html#MereAggregation); MIT (Expat) is listed as GPL-compatible
(https://www.gnu.org/licenses/license-list.html#Expat).
