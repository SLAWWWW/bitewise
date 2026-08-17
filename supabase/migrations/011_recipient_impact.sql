-- Recipient impact dashboard + admin-confirmed deletion of collected stock.
--
-- Once staff confirm a claimed item was actually picked up (or, for
-- partner-beneficiary escalations, actually delivered), its inventory_items
-- row is deleted outright rather than lingering forever with a "Picked up"
-- badge. The recipient's lifetime impact still has to be visible after
-- that, so it's captured here as a running total on their profile —
-- incremented at confirmation time, permanent regardless of what happens
-- to the underlying inventory row afterward. Same pattern donors already
-- use (`donors.total_kg_donated`), just on the claiming side.
ALTER TABLE recipient_profiles ADD COLUMN IF NOT EXISTS total_kg_claimed NUMERIC DEFAULT 0;
ALTER TABLE recipient_profiles ADD COLUMN IF NOT EXISTS donations_completed_count INTEGER DEFAULT 0;

-- Atomic increment (mirrors increment_branch_load in 004) so two devices
-- confirming pickups for the same recipient at the same moment can't lose
-- an update racing a read-then-write.
CREATE OR REPLACE FUNCTION increment_recipient_impact(p_profile_id UUID, p_kg NUMERIC)
RETURNS void AS $$
BEGIN
  UPDATE recipient_profiles
  SET total_kg_claimed = total_kg_claimed + p_kg,
      donations_completed_count = donations_completed_count + 1
  WHERE id = p_profile_id;
END;
$$ LANGUAGE plpgsql;

-- claims.inventory_item_id had no ON DELETE clause (defaults to NO ACTION),
-- so deleting a confirmed item would fail with a foreign-key violation the
-- moment a claims row still pointed at it — which is always true right after
-- pickup confirmation, since that flow updates the claims row rather than
-- removing it. Mirrors the ON DELETE SET NULL already used for
-- beneficiary_allocations.inventory_item_id (008): the claims row survives
-- as a historical log entry, just with a null item reference once deleted.
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_inventory_item_id_fkey;
ALTER TABLE claims ADD CONSTRAINT claims_inventory_item_id_fkey
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
