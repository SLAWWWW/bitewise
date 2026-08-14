-- Bitewise schema — run this first in the Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE donors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('supermarket', 'hotel', 'restaurant', 'factory', 'other')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  reliability_score REAL DEFAULT 0.5 CHECK (reliability_score >= 0 AND reliability_score <= 1),
  total_kg_donated INTEGER DEFAULT 0,
  status TEXT DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_name TEXT NOT NULL DEFAULT 'Willing Hearts',
  name TEXT NOT NULL,
  area TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  capacity_kg INTEGER NOT NULL,
  current_load_kg INTEGER DEFAULT 0,
  has_cold_storage BOOLEAN DEFAULT FALSE,
  has_cooking BOOLEAN DEFAULT FALSE,
  color TEXT DEFAULT '#0A84FF',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- status='pending' means awaiting NGO approval (see /approvals): no branch
-- load or inventory has been committed yet. Only 'matched' onward is real.
CREATE TABLE food_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id UUID REFERENCES donors(id),
  matched_branch_id UUID REFERENCES branches(id),
  item_name TEXT NOT NULL,
  food_type TEXT NOT NULL CHECK (food_type IN ('bread', 'cooked', 'produce', 'canned', 'dairy', 'beverage', 'grain', 'other')),
  quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
  storage_type TEXT NOT NULL CHECK (storage_type IN ('ambient', 'cold', 'frozen')),
  expiry_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'in_transit', 'delivered', 'expired', 'cancelled')),
  matching_score REAL,
  spoilage_risk_score REAL,
  matched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  agreed_to_regulations BOOLEAN NOT NULL DEFAULT FALSE,
  decision_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id),
  item_name TEXT NOT NULL,
  food_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'kg',
  storage_type TEXT NOT NULL CHECK (storage_type IN ('ambient', 'cold', 'frozen')),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  expiry_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'reserved', 'distributed', 'expired', 'escalated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anonymous_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  inventory_item_id UUID REFERENCES inventory_items(id),
  status TEXT DEFAULT 'claimed' CHECK (status IN ('claimed', 'picked_up', 'no_show')),
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  picked_up_at TIMESTAMPTZ
);

CREATE TABLE fairness_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  jain_index REAL NOT NULL,
  branch_ratios JSONB NOT NULL,
  total_food_rescued_kg REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_food_listings_status ON food_listings(status);
CREATE INDEX idx_inventory_items_branch_id ON inventory_items(branch_id);
CREATE INDEX idx_inventory_items_expiry_at ON inventory_items(expiry_at);
CREATE INDEX idx_inventory_items_status ON inventory_items(status);
CREATE INDEX idx_claims_inventory_item_id ON claims(inventory_item_id);

ALTER PUBLICATION supabase_realtime ADD TABLE food_listings;
ALTER PUBLICATION supabase_realtime ADD TABLE branches;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE fairness_snapshots;

-- ───── Row Level Security ─────
-- All writes go through Next.js API routes using the service role key, which
-- bypasses RLS entirely. The only client-side reads are: the orchestrator
-- page's realtime subscription on `branches`, and (optionally) direct reads
-- of non-sensitive operational data. No table exposes anonymous_id-linked
-- claims or the audit log to the anon key — those stay service-role only.

ALTER TABLE donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fairness_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON donors FOR SELECT USING (true);
CREATE POLICY "Public read access" ON branches FOR SELECT USING (true);
CREATE POLICY "Public read access" ON food_listings FOR SELECT USING (true);
CREATE POLICY "Public read access" ON inventory_items FOR SELECT USING (true);
CREATE POLICY "Public read access" ON fairness_snapshots FOR SELECT USING (true);

-- No policies on claims or audit_log for anon/authenticated roles:
-- with RLS enabled and no policy, all client-side access is denied by default.
