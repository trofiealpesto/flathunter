ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS commute_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS commute_source TEXT;

CREATE TABLE IF NOT EXISTS commute_cache (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  minutes INTEGER,
  source TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS commute_cache_query_idx ON commute_cache (query);
