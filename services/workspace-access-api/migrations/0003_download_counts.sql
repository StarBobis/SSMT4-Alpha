ALTER TABLE submissions ADD COLUMN metadata_download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN full_package_download_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS entry_download_events (
  entry_id TEXT NOT NULL,
  download_kind TEXT NOT NULL CHECK (download_kind IN ('metadata', 'full_package')),
  utc_date TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  PRIMARY KEY (entry_id, download_kind, utc_date, ip_key)
);
