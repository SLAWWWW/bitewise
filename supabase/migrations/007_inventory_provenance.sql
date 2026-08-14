-- Links each inventory item back to the donation that produced it.
--
-- Two problems this fixes:
--
-- 1. PROVENANCE. Until now there was no way to answer "which donation did this
--    item come from?" — inventory was created at approval time with no
--    reference back to the listing, so the donor, the original submission and
--    the routing decision were all unreachable from the item.
--
-- 2. DELIVERY PROGRESS. The public food list offered items for collection the
--    moment they were approved, even though the vehicle had not yet been to the
--    donor. With this link, an item can be joined to its open fleet run to
--    derive where it actually is right now — collection scheduled, driver en
--    route, collected and in transit, or arrived at the branch.
--
-- Nullable on purpose: inventory seeded before this migration has no
-- originating listing, and items with no link are treated as already at the
-- branch (which is true — they were seeded there).
--
-- Safe to re-run.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES food_listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_listing_id ON inventory_items(listing_id);
