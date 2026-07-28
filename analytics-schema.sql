-- Privacy-first usage analytics for The Grounded Expat app.
-- Anonymous aggregate counts only: an event name and the calendar day. No email,
-- no IP, nothing that identifies a member.
-- Paste into the SAME D1 database console (tge-community) and run once. Safe to re-run.

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_day ON events (name, day);
