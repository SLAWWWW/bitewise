-- Scheduled daily partner-dispatch runs.
--
-- /api/dispatch has always been read-only — it proposes the most efficient
-- route for a branch's accumulated partner-allocated (escalated) stock, but
-- nothing ever committed that proposal anywhere. This table is what the new
-- daily cron (/api/cron/dispatch-partners, 6pm Singapore time) writes to: one
-- row per branch per day, capturing the exact route/stops/vehicle that ran
-- (or would run), using the same planning logic the live proposal already
-- uses (lib/dispatch-planning.ts) so the two can never disagree.
--
-- `stops` is the full planned route (partner order, items, kg) as JSONB
-- rather than a normalized child table — it's a point-in-time snapshot of a
-- decision already made, not something queried piecemeal afterward.
CREATE TABLE IF NOT EXISTS partner_dispatch_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  vehicle_id UUID REFERENCES vehicles(id),
  dispatch_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'en_route', 'completed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  total_kg REAL NOT NULL DEFAULT 0,
  total_distance_km REAL,
  total_minutes REAL,
  stops JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- One dispatch per branch per day — the cron is idempotent if it ever
  -- fires twice for the same day (retry, manual re-trigger).
  UNIQUE (branch_id, dispatch_date)
);

CREATE INDEX IF NOT EXISTS idx_partner_dispatch_runs_branch_id ON partner_dispatch_runs(branch_id);
CREATE INDEX IF NOT EXISTS idx_partner_dispatch_runs_date ON partner_dispatch_runs(dispatch_date);

ALTER TABLE partner_dispatch_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON partner_dispatch_runs;
CREATE POLICY "Public read access" ON partner_dispatch_runs FOR SELECT USING (true);
