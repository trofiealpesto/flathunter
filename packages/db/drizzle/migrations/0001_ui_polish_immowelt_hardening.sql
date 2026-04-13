ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS analysis_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE portal_sources
  ADD COLUMN IF NOT EXISTS last_mode TEXT,
  ADD COLUMN IF NOT EXISTS last_status TEXT,
  ADD COLUMN IF NOT EXISTS last_listings_found INTEGER,
  ADD COLUMN IF NOT EXISTS last_listings_upserted INTEGER,
  ADD COLUMN IF NOT EXISTS last_failed_details INTEGER;
