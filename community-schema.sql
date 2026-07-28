-- The Circle community — D1 schema.
-- Paste this whole file into the D1 console (Cloudflare > Storage & Databases > D1 >
-- your database > Console) and run it once. Safe to run again; it won't duplicate.

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  space      TEXT    NOT NULL DEFAULT 'This month',
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

-- A warm welcome post from Stephanie, added only if the table is empty.
INSERT INTO posts (email, name, space, body, created_at, hidden)
SELECT 'hello@thegroundedexpat.com', 'Stephanie', 'Welcome',
  'Welcome in. This is a quiet, private place to be honest about the parts of moving abroad that no one warns you about. Introduce yourself when you feel ready: where are you, and what brought you here? I read every post.',
  1753660800000, 0
WHERE NOT EXISTS (SELECT 1 FROM posts);
