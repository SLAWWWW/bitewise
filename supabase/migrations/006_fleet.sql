-- Adds the fleet: the vehicles each branch operates, and a log of every
-- collection run they perform.
--
-- Two tables rather than one, deliberately. A vehicle's *current* state and
-- the *history* of what it has done are different things: cramming both into
-- one row means a completed run overwrites the previous one and the log the
-- logistics page needs doesn't exist.
--
--   vehicles    — what the branch owns. Changes rarely.
--   fleet_runs  — one row per collection job. This IS the log.
--
-- A vehicle's live status is DERIVED from whether it has an open run, so there
-- is a single source of truth and the two can never drift out of sync:
--
--   is_offline = true                        -> offline
--   an open run (assigned/en_route/picked_up) -> that run's status
--   otherwise                                 -> idle
--
-- Cross-branch lending is represented on the run, not the vehicle:
-- fleet_runs.serving_branch_id is the branch the pickup is *for*. When that
-- differs from the vehicle's home branch_id, the vehicle is on loan.
--
-- Safe to re-run: tables are created only if absent, and the seed skips
-- vehicles whose label already exists.

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  label TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('refrigerated', 'truck', 'van', 'bike')),
  driver_name TEXT NOT NULL,
  capacity_kg INTEGER NOT NULL CHECK (capacity_kg > 0),
  -- Set when a vehicle is off the road (servicing, driver unavailable). Kept
  -- separate from run status so taking a van offline never destroys run history.
  is_offline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleet_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  listing_id UUID REFERENCES food_listings(id) ON DELETE SET NULL,
  -- The branch this pickup serves. Differs from the vehicle's home branch when
  -- the vehicle has been borrowed to cover another branch.
  serving_branch_id UUID NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'en_route', 'picked_up', 'completed', 'cancelled')),
  quantity_kg REAL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  en_route_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_branch_id ON vehicles(branch_id);
CREATE INDEX IF NOT EXISTS idx_fleet_runs_vehicle_id ON fleet_runs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_runs_status ON fleet_runs(status);
CREATE INDEX IF NOT EXISTS idx_fleet_runs_listing_id ON fleet_runs(listing_id);

-- At most one open run per vehicle. This is what actually prevents the same van
-- being dispatched to two pickups at once, rather than trusting the app to check
-- first (the same class of race already fixed for approvals and claims).
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_runs_one_open_per_vehicle
  ON fleet_runs (vehicle_id)
  WHERE status IN ('assigned', 'en_route', 'picked_up');

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'Public read access') THEN
    CREATE POLICY "Public read access" ON vehicles FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fleet_runs' AND policyname = 'Public read access') THEN
    CREATE POLICY "Public read access" ON fleet_runs FOR SELECT USING (true);
  END IF;
END $$;

-- ───── Seed: 12 vehicles across the 5 branches ─────
-- Fleet composition mirrors each branch's facilities: branches with cold
-- storage get a refrigerated vehicle, the largest branch gets the truck, and
-- bikes cover small urgent runs. Yishun has no cold storage, so no
-- refrigerated vehicle is based there — which is exactly the situation that
-- forces a cross-branch borrow for a chilled pickup.

INSERT INTO vehicles (branch_id, label, type, driver_name, capacity_kg)
SELECT b.id, v.label, v.type, v.driver_name, v.capacity_kg
FROM (VALUES
  ('Willing Hearts — Woodlands',   'WH-N1', 'refrigerated', 'Rahman B.',   400),
  ('Willing Hearts — Woodlands',   'WH-N2', 'van',          'Siti A.',     250),
  ('Willing Hearts — Woodlands',   'WH-N3', 'bike',         'Kumar S.',     30),
  ('Willing Hearts — Toa Payoh',   'WH-C1', 'refrigerated', 'Mei Ling T.', 350),
  ('Willing Hearts — Toa Payoh',   'WH-C2', 'van',          'Farid H.',    200),
  ('Willing Hearts — Bukit Merah', 'WH-S1', 'truck',        'Devi R.',     600),
  ('Willing Hearts — Bukit Merah', 'WH-S2', 'refrigerated', 'Wei Jie L.',  400),
  ('Willing Hearts — Bukit Merah', 'WH-S3', 'van',          'Nurul I.',    200),
  ('Willing Hearts — Yishun',      'WH-Y1', 'van',          'Arun P.',     250),
  ('Willing Hearts — Yishun',      'WH-Y2', 'bike',         'Joanne C.',    30),
  ('Willing Hearts — Tampines',    'WH-E1', 'refrigerated', 'Hafiz M.',    350),
  ('Willing Hearts — Tampines',    'WH-E2', 'van',          'Grace W.',    220)
) AS v(branch_name, label, type, driver_name, capacity_kg)
JOIN branches b ON b.name = v.branch_name
WHERE NOT EXISTS (SELECT 1 FROM vehicles ex WHERE ex.label = v.label);
