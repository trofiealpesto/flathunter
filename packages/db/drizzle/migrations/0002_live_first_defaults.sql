UPDATE app_settings
SET
  data = jsonb_set(data, '{runtime,scrapeWithFixtures}', 'false'::jsonb, true),
  updated_at = NOW()
WHERE key = 'default'
  AND COALESCE(data->'runtime'->>'scrapeWithFixtures', 'true') = 'true';
