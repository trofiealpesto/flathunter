UPDATE app_settings
SET
  data = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          data,
          '{runtime,llmClassifierModel}',
          CASE
            WHEN COALESCE(data->'runtime'->>'llmClassifierModel', 'gemini-2.5-flash') = 'gemini-2.5-flash'
              THEN '"gemma-4-26b-a4b-it"'::jsonb
            ELSE data->'runtime'->'llmClassifierModel'
          END,
          true
        ),
        '{runtime,llmClassifierFallbackEnabled}',
        COALESCE(data->'runtime'->'llmClassifierFallbackEnabled', 'true'::jsonb),
        true
      ),
      '{runtime,llmClassifierFallbackModel}',
      COALESCE(data->'runtime'->'llmClassifierFallbackModel', '"gemini-2.5-flash"'::jsonb),
      true
    ),
    '{runtime,llmClassifierFallbackMinScore}',
    COALESCE(data->'runtime'->'llmClassifierFallbackMinScore', '80'::jsonb),
    true
  ),
  updated_at = NOW()
WHERE key = 'default';
