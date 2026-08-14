-- Turns partner dispatch from "nearest partner that'll take it, every time"
-- into real demand-quota allocation: every registered beneficiary
-- (lib/data/beneficiaries.ts) has a `daily_quota_kg`, and this table is what
-- lets the app know how much of that quota has actually been filled today,
-- so a beneficiary already at quota stops absorbing donations just because
-- it's the closest one.
--
-- Joined to `lib/data/beneficiaries.ts` by `beneficiary_key` (a stable slug),
-- not by name — beneficiaries are still static reference data (like the
-- food-safety knowledge base), only their fulfilment HISTORY needs to be a
-- real table. `beneficiary_name` is denormalized alongside it purely so a
-- direct SQL read of this table is legible without a second lookup.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS beneficiary_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  beneficiary_key TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  quantity_kg NUMERIC NOT NULL,
  allocated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_allocations_key ON beneficiary_allocations(beneficiary_key);
CREATE INDEX IF NOT EXISTS idx_beneficiary_allocations_allocated_at ON beneficiary_allocations(allocated_at);

ALTER TABLE beneficiary_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON beneficiary_allocations FOR SELECT USING (true);
