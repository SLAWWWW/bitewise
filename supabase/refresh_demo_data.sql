-- Re-freshens seeded inventory expiry windows relative to NOW().
--
-- Why this exists: seed.sql sets expiry_at as `NOW() + INTERVAL '...'` at the
-- moment it runs. Hours later, a third of the demo inventory has quietly gone
-- past its expiry and Branch Inventory renders as a wall of red "Expired"
-- badges — which reads as a broken app rather than a live one.
--
-- Run this before any demo to put every item back into a realistic window for
-- its food type. Safe to re-run as often as you like; it only touches
-- expiry_at, never quantities, branches, statuses, or claims.
--
-- The windows are deliberately spread across all four urgency tiers so the
-- badge system (Critical < 6h, Urgent < 24h, Monitor < 72h, Stable > 72h) is
-- visible at a glance, and one cooked item is pushed under the 3-hour
-- escalation threshold so the partner-beneficiary routing is demonstrable too.

-- Highly perishable: cooked meals.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 hour' * (2 + (random() * 5)))
WHERE food_type = 'cooked';

-- Dairy: short cold-chain window.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 hour' * (4 + (random() * 8)))
WHERE food_type = 'dairy';

-- Produce: same-day to next-day.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 hour' * (6 + (random() * 18)))
WHERE food_type = 'produce';

-- Bread: a day or two.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 hour' * (10 + (random() * 36)))
WHERE food_type = 'bread';

-- Mixed/uncategorised: a few days.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 hour' * (30 + (random() * 60)))
WHERE food_type = 'other';

-- Shelf-stable: months out.
UPDATE inventory_items
SET expiry_at = NOW() + (INTERVAL '1 day' * (60 + (random() * 300)))
WHERE food_type IN ('canned', 'beverage', 'grain');

-- Put exactly one cooked item inside the 3-hour escalation threshold so the
-- "escalated to partner beneficiaries" path has something to demonstrate.
UPDATE inventory_items
SET expiry_at = NOW() + INTERVAL '90 minutes'
WHERE id = (
  SELECT id FROM inventory_items
  WHERE food_type = 'cooked' AND status = 'in_stock'
  ORDER BY received_at
  LIMIT 1
);

-- Anything previously flagged expired/escalated by the lazy escalation sweep
-- goes back to in_stock so it re-enters the public claim list.
UPDATE inventory_items
SET status = 'in_stock'
WHERE status IN ('expired', 'escalated');

-- Release most public claims.
--
-- Every claim made while demoing or testing leaves its item 'reserved' and
-- therefore off the public list. After a few sessions almost nothing is
-- claimable and the recipient page looks broken. This keeps the four
-- most recent claims (so 'Reserved' badges still appear somewhere) and frees
-- the rest.
DELETE FROM claims
WHERE id NOT IN (
  SELECT id FROM claims ORDER BY claimed_at DESC LIMIT 4
);

UPDATE inventory_items
SET status = 'in_stock'
WHERE status = 'reserved'
  AND id NOT IN (SELECT inventory_item_id FROM claims WHERE inventory_item_id IS NOT NULL);
