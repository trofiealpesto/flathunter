UPDATE app_settings
SET data = (
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          data,
          '{runtime,llmProvider}',
          '"gemini"'::jsonb,
          true
        ),
        '{runtime,llmClassifierModel}',
        COALESCE(
          data->'runtime'->'llmClassifierModel',
          data->'runtime'->'ollamaModel',
          '"gemini-2.5-flash-lite"'::jsonb
        ),
        true
      ),
      '{runtime,llmAnalystModel}',
      COALESCE(
        data->'runtime'->'llmAnalystModel',
        data->'runtime'->'ollamaTranslationModel',
        data->'runtime'->'ollamaModel',
        '"gemini-2.5-flash"'::jsonb
      ),
      true
    ),
    '{runtime,enableLlmEnrichment}',
    COALESCE(data->'runtime'->'enableLlmEnrichment', 'true'::jsonb),
    true
  ) #- '{runtime,ollamaModel}' #- '{runtime,ollamaTranslationModel}'
)
WHERE key = 'default';
