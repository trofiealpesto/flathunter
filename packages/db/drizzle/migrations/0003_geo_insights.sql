ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geo_source TEXT;

CREATE TABLE IF NOT EXISTS geocode_cache (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL UNIQUE,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE app_settings
SET
  data = jsonb_set(data, '{search,officeLocation}', 'null'::jsonb, true),
  updated_at = NOW()
WHERE key = 'default'
  AND (data->'search'->'officeLocation') IS NULL;
