import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFrontmatter } from "../content/js/blog-utils.js";
import { isCalendarDate } from "../content/js/dates.js";

// __dirname is not available in ES modules by default
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOMAIN = "https://sfranjou.com";
const POSTS_JSON = path.join(__dirname, "../content/blog/posts.json");
const BLOG_DIR = path.join(__dirname, "../content/blog");
const OUTPUT_FILE = path.join(__dirname, "../content/rss.xml");

function escapeXml(value)
{
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function generateRSS()
{
  console.log("Generating RSS feed...");

  const index = JSON.parse(fs.readFileSync(POSTS_JSON, "utf-8"));
  const posts = index
    .map(({ slug, url }) =>
    {
      const mdPath = path.join(BLOG_DIR, slug, "post.md");
      const md = fs.readFileSync(mdPath, "utf-8");
      const { meta } = parseFrontmatter(md);
      if (!meta.title || !isCalendarDate(meta.date))
      {
        throw new Error(`Post ${ slug } needs a title and a valid YYYY-MM-DD date.`);
      }
      return { ...meta, slug, url };
    });

  // Sort by date descending
  posts.sort((a, b) => b.date.localeCompare(a.date));

  const items = posts
    .map((post) =>
    {
      const url = escapeXml(post.url ? `${ DOMAIN }${ post.url }` : `${ DOMAIN }/blog/post.html?slug=${ encodeURIComponent(post.slug) }`);
      const pubDate = new Date(post.date).toUTCString();
      return `    <item>
      <title>${ escapeXml(post.title) }</title>
      <link>${ url }</link>
      <guid isPermaLink="true">${ url }</guid>
      <pubDate>${ pubDate }</pubDate>
      <description>${ escapeXml(post.summary || "") }</description>
    </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Sebastian Franjou's Blog</title>
    <link>${ DOMAIN }/blog.html</link>
    <description>Thoughts about music, tech, and music tech.</description>
    <language>en-us</language>
    <atom:link href="${ DOMAIN }/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${ new Date().toUTCString() }</lastBuildDate>
${ items }
  </channel>
</rss>`;

  fs.writeFileSync(OUTPUT_FILE, rss);
  console.log(`Successfully generated RSS feed at ${ OUTPUT_FILE }`);
}

generateRSS();
