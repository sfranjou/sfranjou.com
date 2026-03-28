/*
 * post.js — renders a markdown blog post into post.html
 *
 * The post to load is determined by the ?slug= URL parameter.
 * e.g. /blog/post.html?slug=about-this-website
 * fetches: /blog/about-this-website/post.md
 *
 * Relies on marked.js being loaded before this script (see post.html <head>).
 */

import { parseFrontmatter } from "./blog-utils.js";

const slug = new URLSearchParams(window.location.search).get("slug");

async function init()
{
    const text = await fetch(`${ slug }/post.md`).then(r => r.text());
    const { meta, body } = parseFrontmatter(text);

    // Page title and meta description
    document.title = `${ meta.title } — Sebastian Franjou`;
    if (meta.summary) document.querySelector("#meta-description").content = meta.summary;

    // Post header elements
    document.querySelector("#post-title").textContent = meta.title || "Untitled";
    document.querySelector("#post-summary").textContent = meta.summary || "";

    if (meta.date)
    {
        const date = new Date(meta.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
        const tags = (meta.tags || []).map(t => `<a href="../blog.html?tag=${ t }">#${ t }</a>`).join(" ");
        document.querySelector("#post-meta").innerHTML = `${ date } ${ tags }`;
    }

    // Render the markdown body
    document.querySelector("#post-body").innerHTML = marked.parse(body);

    // Set the slug for comments.js (loaded dynamically so comments appear after content)
    document.querySelector("#comments-section").dataset.postSlug = slug;
    const script = document.createElement("script");
    script.src = "../js/comments.js";
    document.body.appendChild(script);
}

init();
