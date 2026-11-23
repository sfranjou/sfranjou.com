# GP-50 firmware installer

Static page: the user drops their own stock Valeton GP-50 V1.1.0 file and gets the modified firmware, built locally in the
browser, then installs it with Valeton Suite. No Valeton code or data is served; the result must match the reviewed image
hash or nothing is offered for download. Browser flashing is deliberately absent.

- `patcher.mjs`: container decode, patch apply, rebuild, SHA-256 check (browser and Node).
- `../lzo/`: LZO1X-1 compress/decompress (miniLZO 2.10 as WebAssembly, GPL-2.0-or-later).
- `patches/*.json`: one per reviewed image, from `scripts/make_web_patch.py` (copy ops into the user's stock regions plus
  our literal bytes; refuses any literal 16-byte window that matches stock; rebuilds the image exactly before writing).
- `releases.json`: list shown on the page.

Patches are made by the maintainers' `make_web_patch.py` from a reviewed image; each lists the image SHA-256 the
page must reproduce. The installer can run on any static web server.

## Download counts

On `https://sfranjou.com`, starting a verified firmware download sends its release version to the site's Supabase
project. The request runs in the background and the download works if it fails. Each click can add one to the
total, so use this as a count of download attempts. Preview and local builds skip the request.

Run `scripts/peppercorn_download_counter.sql` from the development checkout in the site's Supabase SQL Editor.
View totals in `public.peppercorn_downloads` in Supabase. When publishing another release, insert its firmware
version from `releases.json` into the table. The function only updates versions already in that table.
