-- Dispatch used to be gated to one commit per branch per calendar day (the
-- 6pm scheduled cron model). That meant a critical item escalating even
-- minutes after that day's run had already gone out had no path to a real
-- delivery until the next day — exactly backwards for stock that's already
-- within its escalation-threshold hours of spoiling. Dispatch now fires
-- immediately whenever a branch has escalated stock and no dispatch of its
-- own already in flight, so the real constraint is "one active run per
-- branch at a time," not "one run per calendar day."
ALTER TABLE partner_dispatch_runs DROP CONSTRAINT IF EXISTS partner_dispatch_runs_branch_id_dispatch_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_dispatch_runs_one_open_per_branch
  ON partner_dispatch_runs(branch_id) WHERE status <> 'completed';
