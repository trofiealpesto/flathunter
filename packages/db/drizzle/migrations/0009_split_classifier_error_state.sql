ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS semantic_last_error_kind TEXT,
  ADD COLUMN IF NOT EXISTS semantic_last_error_at TIMESTAMPTZ;

UPDATE listings
SET
  semantic_last_error_kind = COALESCE(semantic_last_error_kind, llm_last_error_kind),
  semantic_last_error_at = COALESCE(semantic_last_error_at, llm_last_error_at),
  llm_last_error_kind = NULL,
  llm_last_error_at = NULL
WHERE semantic_input_fingerprint IS NULL
  AND llm_analysis IS NULL
  AND llm_last_error_kind IS NOT NULL;
