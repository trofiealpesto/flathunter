DO $$ BEGIN
  CREATE TYPE portal AS ENUM ('IMMOWELT', 'IMMOSCOUT24', 'KLEINANZEIGEN', 'WG_GESUCHT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('NEW', 'REVIEWED', 'CONTACTED', 'REJECTED', 'BLACKLISTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE eligibility_state AS ENUM ('MATCH', 'UNSURE', 'REJECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_channel AS ENUM ('PORTAL_FORM', 'EMAIL', 'PHONE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_status AS ENUM ('SENT', 'FAILED', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  portal portal NOT NULL,
  portal_listing_id TEXT,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  city TEXT,
  district TEXT,
  neighborhood TEXT,
  rent_cold NUMERIC(10, 2),
  rent_warm NUMERIC(10, 2),
  size_sqm NUMERIC(8, 2),
  rooms NUMERIC(4, 1),
  floor TEXT,
  available_from TEXT,
  is_furnished BOOLEAN NOT NULL DEFAULT FALSE,
  has_balcony BOOLEAN NOT NULL DEFAULT FALSE,
  has_elevator BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER,
  user_status user_status NOT NULL DEFAULT 'NEW',
  eligibility_state eligibility_state NOT NULL DEFAULT 'UNSURE',
  eligibility_reason TEXT,
  semantic_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  semantic_model TEXT,
  raw_payload JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS listings_portal_listing_idx ON listings (portal, portal_listing_id);
CREATE UNIQUE INDEX IF NOT EXISTS listings_canonical_url_idx ON listings (portal, canonical_url);

CREATE TABLE IF NOT EXISTS contact_attempts (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel contact_channel NOT NULL,
  message_subject TEXT,
  message_body TEXT,
  status contact_status NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS portal_sources (
  id SERIAL PRIMARY KEY,
  portal portal NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  search_url TEXT NOT NULL,
  search_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  scrape_interval_minutes INTEGER NOT NULL DEFAULT 30,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_settings_singleton_chk CHECK (key = 'default')
);

