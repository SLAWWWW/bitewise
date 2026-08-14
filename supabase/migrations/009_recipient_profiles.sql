-- Lightweight recipient identity — a name (and optional phone) entered once
-- and persisted client-side, so a claim is no longer fully anonymous, without
-- becoming real authentication (no password, no login). Referenced by claims
-- so staff can see who reserved an item, and so one recipient can be limited
-- to one active reservation at a time.
CREATE TABLE IF NOT EXISTS recipient_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recipient_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON recipient_profiles;
CREATE POLICY "Public read access" ON recipient_profiles FOR SELECT USING (true);

-- Additive only — existing claims keep their anonymous_id (which still
-- defaults itself) and simply have a null profile_id / pickup_deadline_at.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES recipient_profiles(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pickup_deadline_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_claims_profile_id ON claims(profile_id);
CREATE INDEX IF NOT EXISTS idx_claims_pickup_deadline ON claims(pickup_deadline_at);
