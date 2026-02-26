/**
 * Anonymous Threaded Comments — Direct to Supabase
 *
 * Talks directly to Supabase REST API (PostgREST) using the public anon key.
 * No backend/serverless function needed.
 *
 * Setup:
 *   1. Replace SUPABASE_URL and SUPABASE_ANON_KEY below with your project values
 *   2. Add a <div id="comments-section" data-post-slug="your-slug"></div> to your page
 *   3. Include this script after that div
 */

(function ()
{
    "use strict";

    // =====================================================
    // CONFIG — Replace these with your Supabase project values
    // (The anon key is safe to expose — it's meant to be public.
    //  Row Level Security on the table controls what it can do.)
    // =====================================================
    const SUPABASE_URL = "https://awytykefvjohmlkjnkps.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_3UYdDqK0tzZ792tVHhS7ag_3pB6WnTz";
    // =====================================================

    const API_URL = `${ SUPABASE_URL }/rest/v1/comments`;
    const section = document.getElementById("comments-section");
    if (!section) return;

    const POST_SLUG = section.dataset.postSlug;
    if (!POST_SLUG)
    {
        section.innerHTML = "<p>Error: missing data-post-slug attribute.</p>";
        return;
    }

    // --- Supabase REST helpers ---

    async function fetchComments(postSlug)
    {
        const url = `${ API_URL }?post_slug=eq.${ encodeURIComponent(postSlug) }&order=created_at.asc`;
        const res = await fetch(url, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${ SUPABASE_ANON_KEY }`,
            },
        });
        if (!res.ok) throw new Error(`Failed to fetch comments: ${ res.status }`);
        return res.json();
    }

    async function postComment(data)
    {
        const res = await fetch(API_URL, {
            method: "POST",
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${ SUPABASE_ANON_KEY }`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            body: JSON.stringify(data),
        });
        if (!res.ok)
        {
            const err = await res.json();
            throw new Error(err.message || `Failed to post comment: ${ res.status }`);
        }
        return res.json();
    }

    // --- Build the comment tree from flat list ---

    function buildTree(comments)
    {
        const map = {};
        const roots = [];

        comments.forEach((c) =>
        {
            c.children = [];
            map[c.id] = c;
        });

        comments.forEach((c) =>
        {
            if (c.parent_id && map[c.parent_id])
            {
                map[c.parent_id].children.push(c);
            } else
            {
                roots.push(c);
            }
        });

        return roots;
    }

    // --- Render ---

    function renderComment(comment, depth)
    {
        const maxIndent = 4;
        const indent = Math.min(depth, maxIndent) * 1.5;
        const time = new Date(comment.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        let html = `
      <div class="comment" style="margin-left: ${ indent }rem;" data-comment-id="${ comment.id }">
        <div class="comment-header">
          <span class="comment-author">${ escapeHtml(comment.author) }</span>
          <span class="comment-time">${ time }</span>
        </div>
        <div class="comment-body">${ escapeHtml(comment.body) }</div>
        <button class="comment-reply-btn" data-parent-id="${ comment.id }">Reply</button>
        <div class="reply-form-container" id="reply-form-${ comment.id }"></div>
    `;

        comment.children.forEach((child) =>
        {
            html += renderComment(child, depth + 1);
        });

        html += `</div>`;
        return html;
    }

    function escapeHtml(str)
    {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function createCommentForm(parentId)
    {
        return `
      <form class="comment-form" data-parent-id="${ parentId || "" }">
        <input
          type="text"
          name="author"
          placeholder="Name (optional)"
          class="comment-input comment-name"
          maxlength="100"
        />
        <!-- Honeypot — hidden from humans, bots will fill it -->
        <input type="text" name="website" class="comment-hp" tabindex="-1" autocomplete="off" />
        <textarea
          name="body"
          placeholder="Write a comment…"
          class="comment-input comment-textarea"
          required
          maxlength="5000"
          rows="3"
        ></textarea>
        <button type="submit" class="comment-submit">Post Comment</button>
      </form>
    `;
    }

    async function fetchAndRender()
    {
        try
        {
            const comments = await fetchComments(POST_SLUG);
            const tree = buildTree(comments);

            const commentsHtml = tree.map((c) => renderComment(c, 0)).join("");

            section.innerHTML = `
        <h3 class="comments-title">Comments</h3>
        ${ createCommentForm(null) }
        <div class="comments-list">
          ${ commentsHtml || '<p class="no-comments">No comments yet. Be the first!</p>' }
        </div>
      `;

            attachEventListeners();
        } catch (err)
        {
            console.error("Failed to load comments:", err);
            section.innerHTML = `
        <h3 class="comments-title">Comments</h3>
        ${ createCommentForm(null) }
        <p class="comments-error">Could not load comments.</p>
      `;
            attachEventListeners();
        }
    }

    async function submitComment(form)
    {
        const formData = new FormData(form);
        const parentId = form.dataset.parentId || null;

        // Honeypot check — if the hidden field is filled, silently bail
        if (formData.get("website"))
        {
            form.reset();
            return;
        }

        const body = (formData.get("body") || "").trim();
        if (!body) return;
        if (body.length > 5000)
        {
            alert("Comment too long (max 5000 characters).");
            return;
        }

        const payload = {
            post_slug: POST_SLUG,
            body: body,
            author: (formData.get("author") || "").trim() || "Anonymous",
            parent_id: parentId ? parseInt(parentId, 10) : null,
        };

        const submitBtn = form.querySelector(".comment-submit");
        submitBtn.disabled = true;
        submitBtn.textContent = "Posting…";

        try
        {
            await postComment(payload);
            await fetchAndRender();
        } catch (err)
        {
            console.error("Failed to post comment:", err);
            submitBtn.disabled = false;
            submitBtn.textContent = "Post Comment";
            alert("Failed to post comment. Please try again.");
        }
    }

    function attachEventListeners()
    {
        // Submit handlers
        section.querySelectorAll(".comment-form").forEach((form) =>
        {
            form.addEventListener("submit", (e) =>
            {
                e.preventDefault();
                submitComment(form);
            });
        });

        // Reply buttons
        section.querySelectorAll(".comment-reply-btn").forEach((btn) =>
        {
            btn.addEventListener("click", () =>
            {
                const parentId = btn.dataset.parentId;
                const container = document.getElementById(`reply-form-${ parentId }`);

                if (container.querySelector(".comment-form"))
                {
                    container.innerHTML = "";
                    return;
                }

                container.innerHTML = createCommentForm(parentId);

                const form = container.querySelector(".comment-form");
                form.addEventListener("submit", (e) =>
                {
                    e.preventDefault();
                    submitComment(form);
                });

                form.querySelector("textarea").focus();
            });
        });
    }

    // --- Init ---
    fetchAndRender();
})();
