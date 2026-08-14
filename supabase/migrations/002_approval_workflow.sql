-- Adds the NGO approval workflow on top of an already-provisioned Bitewise
-- database. Safe to run once against a live project that already has
-- schema.sql + seed.sql applied — it only adds columns/values, nothing is
-- dropped or rewritten.

ALTER TABLE food_listings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE food_listings ADD COLUMN IF NOT EXISTS agreed_to_regulations BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE food_listings ADD COLUMN IF NOT EXISTS decision_details JSONB;

-- Widen donors.type to include 'other', for public donors that don't fit the
-- original 4 categories. Existence is checked directly against pg_constraint
-- (rather than relying on DROP...IF EXISTS + ADD running as two independent
-- statements) so this is safe no matter how many times or in what state it's
-- re-run — including if a previous partial run already got the drop half done.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'donors'::regclass AND conname = 'donors_type_check'
  ) THEN
    ALTER TABLE donors DROP CONSTRAINT donors_type_check;
  END IF;

  ALTER TABLE donors ADD CONSTRAINT donors_type_check
    CHECK (type IN ('supermarket', 'hotel', 'restaurant', 'factory', 'other'));
END $$;
