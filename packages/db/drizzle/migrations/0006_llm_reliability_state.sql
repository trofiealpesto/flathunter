ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS semantic_input_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS semantic_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS llm_last_error_kind TEXT,
  ADD COLUMN IF NOT EXISTS llm_last_error_at TIMESTAMPTZ;

UPDATE app_settings
SET
  data = jsonb_set(
    data,
    '{runtime,ollamaModel}',
    COALESCE(data->'runtime'->'ollamaModel', '"gemma3:4b"'::jsonb),
    true
  ),
  updated_at = NOW()
WHERE key = 'default';
