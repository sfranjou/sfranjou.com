/*
 * blog-list.js — <blog-list> web component
 *
 * Usage: <blog-list count="3" tag="music"></blog-list>
 *   count  — optional, limits how many posts are shown
 *   tag    — optional, filters by tag (can also be set via ?tag= in the URL)
 *
 * Expected structure:
 *   content/blog/posts.json        — array of { "slug": "my-post-slug" }
 *   content/blog/[slug]/post.md    — markdown file with frontmatter
 *
 * Frontmatter format (at the top of each post.md):
 *   ---
 *   title: My Post Title
 *   date: 2026-03-28
 *   summary: A short description
 *   tags: [music, web]
 *   ---
 */

import { parseFrontmatter } from "../blog-utils.js";

class BlogList extends HTMLElement
{
  async connectedCallback()
  {
    const maxPosts = parseInt(this.getAttribute("count")) || Infinity;
    const tagFilter = (new URLSearchParams(window.location.search).get("tag") || this.getAttribute("tag") || "").toLowerCase();

    const posts = await this.loadPosts();

    const filtered = posts
      .filter(p => !tagFilter || (p.tags || []).includes(tagFilter))
      .slice(0, maxPosts);

    this.innerHTML = filtered.length === 0
      ? "<p>No posts found.</p>"
      : `<ul class="blog-list">${ filtered.map(p => this.renderItem(p)).join("") }</ul>`;
  }

  async loadPosts()
  {
    const res = await fetch("blog/posts.json");
    const index = await res.json();

    const posts = await Promise.all(index.map(async ({ slug }) =>
    {
      const md = await fetch(`blog/${ slug }/post.md`).then(r => r.text());
      const { meta } = parseFrontmatter(md);
      return { slug, ...meta };
    }));

    // Since we use YYYY-MM-DD, we can sort alphabetically with regular string compare
    return posts.sort((a, b) => b.date.localeCompare(a.date));
  }

  renderItem(post)
  {
    const date = new Date(post.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const tags = (post.tags || []).map(t => `<a href="blog.html?tag=${ t }">#${ t }</a>`).join(" ");
    const summary = post.summary ? `<p class="blog-post-summary">${ post.summary }</p>` : "";
    return `<li>
            <a href="blog/post.html?slug=${ post.slug }" class="blog-post-link">${ post.title }</a>
            <span class="blog-post-date"> ${ date } ${ tags }</span>
            ${ summary }
        </li>`;
  }
}

customElements.define("blog-list", BlogList);
