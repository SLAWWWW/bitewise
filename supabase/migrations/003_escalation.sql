-- Adds the 'escalated' inventory status used by the partner-beneficiary
-- routing logic: unclaimed items within a few hours of spoiling stop
-- waiting on public claims and are flagged for direct dispatch to Willing
-- Hearts' known/partner beneficiaries instead. Safe to re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'inventory_items'::regclass AND conname = 'inventory_items_status_check'
  ) THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_status_check;
  END IF;

  ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check
    CHECK (status IN ('in_stock', 'reserved', 'distributed', 'expired', 'escalated'));
END $$;
