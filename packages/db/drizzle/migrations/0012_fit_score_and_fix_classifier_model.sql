-- Add semantic_fit_score column for graded LLM fit ranking
ALTER TABLE listings ADD COLUMN IF NOT EXISTS semantic_fit_score integer;

-- Fix bad primary classifier model written by migration 0011.
-- gemma-4-26b-a4b-it is not a real Gemini API model; replace with gemini-2.5-flash-lite (free tier).
UPDATE app_settings
SET
  data = jsonb_set(
    data,
    '{runtime,llmClassifierModel}',
    CASE
      WHEN data->'runtime'->>'llmClassifierModel' = 'gemma-4-26b-a4b-it'
        THEN '"gemini-2.5-flash-lite"'::jsonb
      ELSE data->'runtime'->'llmClassifierModel'
    END,
    true
  ),
  updated_at = NOW()
WHERE key = 'default';
