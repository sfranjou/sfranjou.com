-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the comments table and sets up Row Level Security so the
-- anon key can only SELECT and INSERT (no updates, no deletes).

-- 1. Create the table
CREATE TABLE comments (
  id         SERIAL PRIMARY KEY,
  post_slug  TEXT NOT NULL,
  parent_id  INTEGER REFERENCES comments(id),
  author     TEXT NOT NULL DEFAULT 'Anonymous',
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post_slug ON comments(post_slug);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);

-- 2. Enable Row Level Security
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- 3. Allow anyone to read comments
CREATE POLICY "Anyone can read comments"
  ON comments FOR SELECT
  USING (true);

-- 4. Allow anyone to insert comments
CREATE POLICY "Anyone can insert comments"
  ON comments FOR INSERT
  WITH CHECK (true);

-- That's it. No UPDATE or DELETE policies = anonymous users can't
-- edit or remove comments. You can still manage them via the
-- Supabase dashboard or with the service_role key.
