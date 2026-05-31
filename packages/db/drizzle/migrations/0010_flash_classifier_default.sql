UPDATE app_settings
SET
  data = jsonb_set(
    data,
    '{runtime,llmClassifierModel}',
    '"gemini-2.5-flash"'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE key = 'default'
  AND COALESCE(data->'runtime'->>'llmClassifierModel', 'gemini-2.5-flash-lite') = 'gemini-2.5-flash-lite';
