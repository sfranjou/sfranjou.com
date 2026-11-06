-- Run once on an existing comments table. The transaction rolls back if existing
-- comments violate a constraint; correct those rows before running it again.
BEGIN;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_author_length CHECK (char_length(author) <= 100 AND author ~ '[^[:space:]]'),
  ADD CONSTRAINT comments_body_length CHECK (char_length(body) <= 5000 AND body ~ '[^[:space:]]'),
  ADD CONSTRAINT comments_post_slug_format CHECK (post_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT comments_id_post_slug_key UNIQUE (id, post_slug),
  DROP CONSTRAINT comments_parent_id_fkey,
  ADD CONSTRAINT comments_parent_same_post
    FOREIGN KEY (parent_id, post_slug) REFERENCES public.comments (id, post_slug);

-- Callers supply content only. PostgreSQL supplies the ID and timestamp.
REVOKE ALL ON public.comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comments TO anon, authenticated;
GRANT INSERT (post_slug, parent_id, author, body) ON public.comments TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.comments_id_seq TO anon, authenticated;

COMMIT;
