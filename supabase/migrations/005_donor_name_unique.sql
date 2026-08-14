-- Closes the last known check-then-insert race: /api/listings looks a donor up
-- by name and creates one if absent, so two simultaneous first-time
-- submissions under the same new business name could both pass the lookup and
-- each insert a row — leaving one business split across two donor records with
-- divided donation totals.
--
-- Matching is case-insensitive in the application (.ilike), so the constraint
-- has to be too, otherwise 'Golden Spoon' and 'golden spoon' would still slip
-- through as separate rows. Names are also trimmed so trailing whitespace
-- can't be used to duplicate a donor either.
--
-- With this in place the API route can insert optimistically and treat a
-- unique violation (SQLSTATE 23505) as "someone else just created it" and
-- re-read the winning row.
--
-- Safe to re-run. Verified against the live project before writing: no
-- duplicate donor names existed, so this applies cleanly.

CREATE UNIQUE INDEX IF NOT EXISTS idx_donors_name_unique_ci
  ON donors (lower(btrim(name)));
