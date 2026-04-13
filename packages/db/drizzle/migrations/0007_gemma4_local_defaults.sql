UPDATE app_settings
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{runtime,ollamaModel}',
      '"gemma4:latest"'::jsonb,
      true
    ),
    '{runtime,ollamaTranslationModel}',
    '"gemma4:latest"'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE key = 'default';
