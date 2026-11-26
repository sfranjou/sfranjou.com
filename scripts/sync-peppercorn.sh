#!/usr/bin/env bash
# Import a Peppercorn release into the website working tree for review.
set -euo pipefail

apply=false
if [[ ${1:-} == --apply ]]; then
  apply=true
  shift
fi
if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/sync-peppercorn.sh [--apply] PEPPERCORN_CHECKOUT RELEASE_REF" >&2
  exit 2
fi

peppercorn=$1
ref=$2
site=$(cd "$(dirname "$0")/.." && pwd)
dest="$site/content/gp50"
# Only these paths are supplied by Peppercorn. Website pages such as research
# and the GP-50 landing page's content stay in the website repo.
dirs=(audio captures editor gp50 installer lzo media test trainer uploader)
files=(LICENSE LICENSING.md THIRD_PARTY.md site.css RELEASE_NOTES.md)
managed=()
for path in "${dirs[@]}" "${files[@]}"; do managed+=("content/gp50/$path"); done
if [[ -n $(git -C "$site" status --porcelain --untracked-files=all) ]]; then
  echo "Use a clean website checkout so the import cannot overwrite local edits." >&2
  exit 1
fi

if [[ -n $(git -C "$site" ls-files --others --ignored --exclude-standard -- "${managed[@]}") ]]; then
  echo "Move ignored files out of the managed Peppercorn paths before importing." >&2
  exit 1
fi

# Once bootstrapped, catch site-only edits even when they have been committed.
website_head=$(git -C "$site" rev-parse HEAD)
if [[ -f $site/PEPPERCORN_COMMIT ]]; then
  last_import=$(git -C "$site" log -1 --format=%H -- PEPPERCORN_COMMIT)
else
  echo "First import: review the file list for any website changes that belong in Peppercorn."
fi

# A release name should resolve to a tag even if a branch has the same name.
if [[ $ref =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then ref="refs/tags/$ref"; fi
commit=$(git -C "$peppercorn" rev-parse --verify --end-of-options "${ref}^{commit}")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$peppercorn" archive "$commit" RELEASE_NOTES.md site | tar -xf - -C "$tmp"

# Check that the default installer entry agrees with the source release notes.
# Prepare a new version badge while preserving the website's own landing page.
node - "$tmp" "$dest/index.html" "$ref" <<'JS'
const fs = require('node:fs');
const [src, landing, ref] = process.argv.slice(2);
const read = path => fs.readFileSync(path, 'utf8');
const {releases: [release]} = JSON.parse(read(src + '/site/installer/releases.json'));
const version = /^Peppercorn (v\d+\.\d+\.\d+)$/.exec(release.title)?.[1];
const notes = read(src + '/RELEASE_NOTES.md');
if (!version || !notes.split('\n').some(line => line.replace(/^#+ /, '') ===
    `Peppercorn ${version} (on-screen version ${release.version})`)) {
  throw new Error('The default installer entry does not match the release notes.');
}
const tag = /^(?:refs\/tags\/)?(v\d+\.\d+\.\d+)$/.exec(ref)?.[1];
if (tag && tag !== version) throw new Error(`Release tag ${tag} does not match ${version}.`);
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

cp "$tmp/RELEASE_NOTES.md" "$tmp/site/RELEASE_NOTES.md"
if [[ -n ${last_import:-} ]]; then
  drift=()
  while IFS= read -r -d '' path; do
    incoming="$tmp/site/${path#content/gp50/}"
    current="$site/$path"
    if [[ ! -e $incoming && ! -e $current && ! -L $incoming && ! -L $current ]]; then continue; fi
    if [[ -f $incoming && -f $current ]] && cmp -s "$incoming" "$current"; then continue; fi
    drift+=("$path")
  done < <(git -C "$site" diff --name-only --no-renames -z "$last_import" "$website_head" -- "${managed[@]}")
  if (( ${#drift[@]} )); then
    echo "Website changes would be replaced; reconcile them in Peppercorn first:" >&2
    printf '  %s\n' "${drift[@]}" >&2
    exit 1
  fi
fi
for dir in "${dirs[@]}"; do test -d "$tmp/site/$dir"; done
for file in "${files[@]}"; do test -f "$tmp/site/$file"; done
echo "Peppercorn commit: $commit"
if ! $apply; then
  for dir in "${dirs[@]}"; do
    rsync -rlpcn --delete --out-format="$dir/%n" "$tmp/site/$dir/" "$dest/$dir/"
  done
  for file in "${files[@]}"; do
    if ! cmp -s "$tmp/site/$file" "$dest/$file"; then echo "$file"; fi
  done
  if ! cmp -s "$tmp/landing.html" "$dest/index.html"; then echo "index.html (version badge)"; fi
  if [[ $(cat "$site/PEPPERCORN_COMMIT" 2>/dev/null || true) != "$commit" ]]; then echo "PEPPERCORN_COMMIT"; fi
  echo "Preview only. Re-run with --apply to import this commit."
  exit 0
fi

if [[ $(git -C "$site" rev-parse HEAD) != "$website_head" ||
      -n $(git -C "$site" status --porcelain --untracked-files=all) ]]; then
  echo "The website checkout changed during preparation. Import cancelled." >&2
  exit 1
fi
for dir in "${dirs[@]}"; do rsync -rlpc --delete "$tmp/site/$dir/" "$dest/$dir/"; done
for file in "${files[@]}"; do cp "$tmp/site/$file" "$dest/$file"; done
cp "$tmp/landing.html" "$dest/index.html"
printf '%s\n' "$commit" > "$site/PEPPERCORN_COMMIT"
echo "Imported $commit. Review the website diff before committing or deploying."
