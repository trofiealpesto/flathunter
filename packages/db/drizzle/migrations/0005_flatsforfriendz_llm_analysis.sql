ALTER TYPE portal ADD VALUE IF NOT EXISTS 'FLATSFORFRIENDZ';

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS llm_analysis JSONB;

UPDATE app_settings
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{runtime,enableLlmEnrichment}',
      COALESCE(data->'runtime'->'enableLlmEnrichment', 'true'::jsonb),
      true
    ),
    '{runtime,ollamaTranslationModel}',
    COALESCE(to_jsonb(data->'runtime'->>'ollamaTranslationModel'), '"translategemma:4b"'::jsonb),
    true
  ),
  updated_at = NOW()
WHERE key = 'default';
