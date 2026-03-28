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
            return { slug, ...parseFrontmatter(md) };
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

// Parses the --- frontmatter block at the top of a markdown file.
// Returns an object with title, date, summary, tags, etc.
function parseFrontmatter(text)
{
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const data = {};
    for (const line of match[1].split("\n"))
    {
        const i = line.indexOf(":");
        if (i === -1) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim();
        data[key] = val.startsWith("[") ? val.slice(1, -1).split(",").map(s => s.trim()) : val;
    }
    return data;
}

customElements.define("blog-list", BlogList);
