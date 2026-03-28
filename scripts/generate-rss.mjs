import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFrontmatter } from "../content/js/blog-utils.js";

// __dirname is not available in ES modules by default
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOMAIN = "https://sfranjou.com";
const POSTS_JSON = path.join(__dirname, "../content/blog/posts.json");
const BLOG_DIR = path.join(__dirname, "../content/blog");
const OUTPUT_FILE = path.join(__dirname, "../content/rss.xml");

function generateRSS()
{
  console.log("Generating RSS feed...");

  if (!fs.existsSync(POSTS_JSON))
  {
    console.error("posts.json not found!");
    return;
  }

  const index = JSON.parse(fs.readFileSync(POSTS_JSON, "utf-8"));
  const posts = index
    .map(({ slug }) =>
    {
      const mdPath = path.join(BLOG_DIR, slug, "post.md");
      if (!fs.existsSync(mdPath)) return null;
      const md = fs.readFileSync(mdPath, "utf-8");
      const { meta } = parseFrontmatter(md);
      return { slug, ...meta };
    })
    .filter(Boolean);

  // Sort by date descending
  posts.sort((a, b) => b.date.localeCompare(a.date));

  const items = posts
    .map((post) =>
    {
      const url = `${ DOMAIN }/blog/post.html?slug=${ post.slug }`;
      const pubDate = new Date(post.date).toUTCString();
      return `    <item>
      <title>${ post.title || "Untitled" }</title>
      <link>${ url }</link>
      <guid isPermaLink="true">${ url }</guid>
      <pubDate>${ pubDate }</pubDate>
      <description>${ post.summary || "" }</description>
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
