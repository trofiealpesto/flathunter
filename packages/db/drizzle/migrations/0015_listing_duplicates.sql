ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS duplicate_of_listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS listings_duplicate_of_idx ON listings (duplicate_of_listing_id);
