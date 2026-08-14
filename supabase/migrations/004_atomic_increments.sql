-- Fixes a reproduced race condition: two concurrent approvals of the same
-- listing (double-click, or two staff acting at once) both passed the
-- read-then-write branch/donor updates in application code, causing a lost
-- update on current_load_kg/total_kg_donated and — worse — a duplicate
-- inventory_items row (phantom food that doesn't physically exist).
--
-- The application-level fix claims the listing with an atomic
-- UPDATE ... WHERE status = 'pending' guard before doing anything else.
-- These two functions close the second half of the gap: they let Postgres
-- do the increment in a single atomic statement instead of the app reading
-- a value, adding to it in JS, and writing it back.

CREATE OR REPLACE FUNCTION increment_branch_load(p_branch_id UUID, p_amount NUMERIC)
RETURNS INTEGER AS $$
DECLARE
  new_load INTEGER;
BEGIN
  UPDATE branches
  SET current_load_kg = current_load_kg + p_amount
  WHERE id = p_branch_id
  RETURNING current_load_kg INTO new_load;
  RETURN new_load;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_donor_total(p_donor_id UUID, p_amount NUMERIC)
RETURNS INTEGER AS $$
DECLARE
  new_total INTEGER;
BEGIN
  UPDATE donors
  SET total_kg_donated = total_kg_donated + p_amount
  WHERE id = p_donor_id
  RETURNING total_kg_donated INTO new_total;
  RETURN new_total;
END;
$$ LANGUAGE plpgsql;
