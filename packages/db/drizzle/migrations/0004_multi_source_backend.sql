CREATE TABLE IF NOT EXISTS portal_credentials (
  id SERIAL PRIMARY KEY,
  portal portal NOT NULL UNIQUE,
  auth_mode TEXT NOT NULL,
  login_identifier TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id SERIAL PRIMARY KEY,
  portal portal NOT NULL UNIQUE,
  encrypted_storage_state TEXT,
  status TEXT NOT NULL DEFAULT 'missing_credentials',
  expires_at TIMESTAMPTZ,
  last_authenticated_at TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ,
  last_auth_error TEXT,
  last_challenge_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
