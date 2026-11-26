// This page is also a blog post (content/blog/posts.json, slug "lttc-research"). Its date and tags live
// in that post's post.md, so the blog list, the RSS feed and this page all show the same ones.
import {parseFrontmatter} from '/js/blog-utils.js';
import {formatCalendarDate} from '/js/dates.js';

const {meta} = parseFrontmatter(await (await fetch('/blog/lttc-research/post.md')).text());
const tags = (meta.tags || []).map(t => `<a href="/blog.html?tag=${t}">#${t}</a>`).join(' ');
document.getElementById('post-meta').innerHTML = `${formatCalendarDate(meta.date)} ${tags}`;
