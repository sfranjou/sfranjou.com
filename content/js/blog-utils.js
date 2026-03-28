/*
 * blog-utils.js — shared utilities for blog post parsing
 */

/**
 * Splits a markdown file into the frontmatter metadata and the body.
 * @param {string} text - The raw markdown text with --- frontmatter.
 * @returns {{ meta: Object, body: string }}
 */
export function parseFrontmatter(text)
{
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split("\n"))
  {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    // Simple array parsing for [tag1, tag2]
    meta[key] = val.startsWith("[")
      ? val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
      : val;
  }
  return { meta, body: match[2] };
}
