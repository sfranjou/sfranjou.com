#!/usr/bin/env bash
# Import a Peppercorn release into the website working tree for review.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/sync-peppercorn.sh PEPPERCORN_CHECKOUT RELEASE_REF" >&2
  exit 2
fi

peppercorn=$1
ref=$2
site=$(cd "$(dirname "$0")/.." && pwd)
dest="$site/content/gp50"
if [[ -n $(git -C "$site" status --porcelain) ]]; then
  echo "Use a clean website checkout so the import cannot overwrite local edits." >&2
  exit 1
fi

commit=$(git -C "$peppercorn" rev-parse --verify "${ref}^{commit}")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$peppercorn" archive "$commit" RELEASE_NOTES.md site | tar -xf - -C "$tmp"

# Check that the default installer entry agrees with the source release notes.
# Prepare a new version badge while preserving the website's own landing page.
node - "$tmp" "$dest/index.html" <<'JS'
const fs = require('node:fs');
const [src, landing] = process.argv.slice(2);
const read = path => fs.readFileSync(path, 'utf8');
const {releases: [release]} = JSON.parse(read(src + '/site/installer/releases.json'));
const version = /^Peppercorn (v\d+\.\d+\.\d+)$/.exec(release.title)?.[1];
const notes = read(src + '/RELEASE_NOTES.md');
if (!version || !notes.split('\n').some(line => line.replace(/^#+ /, '') ===
    `Peppercorn ${version} (on-screen version ${release.version})`)) {
  throw new Error('The default installer entry does not match the release notes.');
}
if (!/^patches\/[\w.-]+\.json$/.test(release.patch)) {
  throw new Error('Invalid installer patch path.');
}
const patch = JSON.parse(read(src + '/site/installer/' + release.patch));
if (patch.version !== release.version || !/^[a-f0-9]{64}$/.test(patch.image_sha256)) {
  throw new Error('Installer patch does not match the release entry.');
}
const badge = /(<p class="release">)v\d+\.\d+\.\d+(<\/p>)/;
const html = read(landing);
if (!badge.test(html)) throw new Error('Release badge missing from the GP-50 landing page.');
fs.writeFileSync(src + '/landing.html', html.replace(badge, (_, open, close) => open + version + close));
console.log(`Prepared ${version} (on-screen version ${release.version})`);
JS

# Only these paths are supplied by Peppercorn. Website pages such as research
# and the GP-50 landing page's content stay in the website repo.
dirs=(audio captures editor gp50 installer lzo media test trainer uploader)
files=(LICENSE LICENSING.md THIRD_PARTY.md site.css)
for dir in "${dirs[@]}"; do test -d "$tmp/site/$dir"; done
for file in "${files[@]}"; do test -f "$tmp/site/$file"; done
for dir in "${dirs[@]}"; do rsync -a --delete "$tmp/site/$dir/" "$dest/$dir/"; done
for file in "${files[@]}"; do cp "$tmp/site/$file" "$dest/$file"; done
cp "$tmp/RELEASE_NOTES.md" "$dest/RELEASE_NOTES.md"
cp "$tmp/landing.html" "$dest/index.html"
printf '%s\n' "$commit" > "$site/PEPPERCORN_COMMIT"
echo "Imported $commit. Review the website diff before committing or deploying."
