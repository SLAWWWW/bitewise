-- Tracks how (and that) a donation's journey actually ended.
--
-- `food_listings.delivered_at` already existed in the schema but was never
-- written by any app code — only static seed data used it. Nothing recorded
-- WHICH channel a donation finished through, and once its inventory_items
-- row was deleted (the normal close-out path for every completion route:
-- public pickup, partner delivery, recycling), that information was gone
-- for good. This is exactly why an item that started as a genuine public
-- listing but was later escalated and delivered to a partner kept showing
-- "Publicly listed" forever afterward — the only signal available
-- (RUN_STAGE['completed']) predates the escalation and has no way to know
-- what happened after.
ALTER TABLE food_listings ADD COLUMN IF NOT EXISTS completed_via TEXT
  CHECK (completed_via IN ('public_pickup', 'partner_delivery', 'recycled'));

CREATE INDEX IF NOT EXISTS idx_food_listings_delivered_at ON food_listings(delivered_at);
