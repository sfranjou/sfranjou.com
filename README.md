# sfranjou.com

My personal website: plain HTML, CSS, and JavaScript, hosted on Netlify.
No package installation is needed. Node.js generates the RSS feed during deployment.

## Preview locally

From the repository root:

```sh
node scripts/generate-rss.mjs
python3 -m http.server 8000 --directory content
```

Open http://localhost:8000. Use a local server rather than opening HTML files
with `file://`, because the blog and concerts fetch data over HTTP.

## Structure

- `content/`: Published HTML, CSS, JavaScript, images, and blog Markdown.
- `content/js/components/`: Shared concert, blog list, and footnote elements.
- `scripts/generate-rss.mjs`: Generates `content/rss.xml`, which Git ignores.
- `netlify.toml`: Runs the RSS command and publishes `content/`.
- `supabase-schema.sql`: Initial setup for the optional blog comments database.

## Add a blog post

1. Create `content/blog/my-post/post.md` and put its images in the same folder.
2. Add `{ "slug": "my-post" }` to `content/blog/posts.json`.
3. Run `node scripts/generate-rss.mjs` and preview the blog and feed.

A post can also be a standalone page elsewhere on the site, like the LTTC research
page: add its path as `"url"` in `posts.json` (for example
`{ "slug": "lttc-research", "url": "/gp50/research/" }`) and keep a `post.md` with
just the metadata. The blog list and RSS feed link to that page, and
`post.html?slug=...` redirects there. The page adds its own comments section with
`data-post-slug` set to the slug.

Use lowercase words separated by hyphens for slugs. The Markdown starts with:

```text
---
title: My post title
date: 2026-11-06
summary: A short description
tags: [music, software]
---

Post text goes here.
```

This is a small custom metadata format, not YAML. Use one unquoted value per
line and comma-separated tags inside brackets. Titles and valid `YYYY-MM-DD`
dates are required; summaries and tags are optional. LF and CRLF line endings
both work. Only posts listed in `posts.json` can be opened.

Posts currently render in the browser using a pinned version of Marked.
Raw HTML and `<inline-footnote>` are supported, so only put trusted content in
post files. Images are resolved relative to `/blog/`: for this example, use
`my-post/image.png`. Blog lists and posts currently require JavaScript.

The RSS build fails if a listed post is missing or has invalid required metadata.

## External services

- Concerts read published Google Sheets CSV URLs from each `<gig-info>` element.
  PapaParse reads the CSV. Columns are `Name`, `Venue`, `Address`, `Date`, `Link`,
  and `Blurb`. Names and valid dates are required. Links must use HTTP or HTTPS.
  Use `YYYY-MM-DD` for date-only shows, or an ISO timestamp with an explicit
  timezone offset, such as `2026-11-06T20:00:00-05:00`. Date-only shows stay
  upcoming for their entire Boston calendar day; timed shows display Boston time.
  The One Red Cent concert section is intentionally hidden.
- Comments use Supabase's REST API directly. The publishable key in
  `content/js/comments.js` is public; database permissions and Row Level Security
  control access. There is no Supabase JavaScript dependency.
- The band page uses Google Fonts and Google Drive video embeds. RSS icons come
  from Simple Icons.
- Cloudflare Web Analytics runs on production through Netlify’s Snippet Injection.
  See the [site privacy notice](content/privacy.html).

For a new comments database, run `supabase-schema.sql` in the Supabase SQL Editor.
For the existing original table, run `scripts/harden-comments.sql` **once** instead.
It adds length and slug-format checks, keeps replies within the same post, and
allows visitors to supply only the author, body, post slug, and parent comment.
If existing rows violate a constraint, the transaction rolls back; correct those
rows in Supabase and try again. Slug checks enforce the format, not membership in
`posts.json`. These rules do not rate-limit requests or prevent spam. Moderate
comments in the Supabase dashboard.

## Deployment

Netlify automatically deploys pushes to `master`. Its build command is:

```sh
node scripts/generate-rss.mjs
```

The QLC proxy scripts and `qlcplan` notes are a separate local lighting-control
utility. They are not needed to preview, build, or deploy this website and are
outside the published `content/` directory.

### Updating the GP-50 tools

Peppercorn owns the shared editor, installer, and release notes. From a clean
website checkout, import a reviewed release by its tag (or exact local commit
when previewing):

```sh
scripts/sync-peppercorn.sh ../Peppercorn v0.2.0
```

Fetch the latest published release into the Peppercorn checkout first if needed.
The command copies the tools and release notes, updates the version badge,
and records the exact source in `PEPPERCORN_COMMIT`. It leaves the rest of the
landing page and the research pages in the website repo. Review the diff,
then commit and deploy through the usual website workflow.
