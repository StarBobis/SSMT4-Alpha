CREATE TABLE IF NOT EXISTS daily_quota (
  utc_date TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  submission_count INTEGER NOT NULL DEFAULT 0,
  reserved_bytes INTEGER NOT NULL DEFAULT 0,
  committed_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (utc_date, ip_key)
);

CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  declared_size INTEGER NOT NULL DEFAULT 0,
  object_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_entry_id ON submissions(entry_id);
