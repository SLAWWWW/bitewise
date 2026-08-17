-- 009 gave recipient_profiles a "Public read access" policy by copying the
-- template used for non-sensitive tables (donors, branches, listings)
-- without noticing this table actually holds recipient name + phone number.
-- Nothing legitimate depends on it: the client only ever reaches this data
-- through POST /api/profiles, which uses the service-role key server-side.
-- Dropping it restores the same default-deny posture already used correctly
-- for claims and audit_log.
DROP POLICY IF EXISTS "Public read access" ON recipient_profiles;
