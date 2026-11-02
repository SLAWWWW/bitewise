# Lumbung database

PostgreSQL 17. Everything lives in schema `lumbung`, so nothing is exposed through Supabase PostgREST. Migrations use no extensions (`gen_random_uuid()` and `sha256()` are built in) and never create roles. Design: `docs/architecture.md` §A, with binding contracts in §G.

## Local workflow

```bash
npm run db:start       # foreground embedded PG 17: .data/pg, port 54329 (Ctrl-C stops it)
npm run db:bootstrap   # roles + database "lumbung" (idempotent)
npm run db:migrate     # apply db/migrations/NNNN_*.sql (no-op when up to date)
```

- `db:start` (`scripts/db/start.ts`) runs initdb with `--locale=C --encoding=UTF8` only when `.data/pg/PG_VERSION` is absent. If a server crashed and left a stale `postmaster.pid`, the script removes it. If the pid is still alive, the script refuses to start.
  - Flags: `--dir`, `--port`, `--ephemeral`, `--verbose`.
  - Programmatic use: `startEmbedded({ dir, port, persistent })` and `ensureCluster(candidates)`.
- `tsx scripts/db/create-test-db.ts [name]` drops (`WITH (FORCE)`), creates and migrates a test database. The default name is `lumbung_test`. It prints `TEST_DATABASE_URL` and `TEST_DATABASE_OWNER_URL`.
- The CLI scripts load `.env.local` and then `.env` without overriding variables that are already set. The defaults are the G.1 development URLs.

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_ADMIN_URL` | bootstrap only (superuser) | `postgres://postgres:postgres@localhost:54329/postgres` |
| `DATABASE_OWNER_URL` | migrate / seed / reset | `postgres://lumbung_owner:lumbung_owner@localhost:54329/lumbung` |
| `DATABASE_URL` | web + worker runtime | `postgres://lumbung_app:lumbung_app@localhost:54329/lumbung` |
| `TEST_DATABASE_ADMIN_URL` | tests / create-test-db | falls back to `DATABASE_ADMIN_URL` |

Bootstrap takes the role passwords from the userinfo of `DATABASE_OWNER_URL` and `DATABASE_URL`, so those URLs always work. With `APP_MODE=LIVE` it refuses the development passwords.

## Roles (`db/bootstrap.sql`)

| Role | Attributes | Purpose |
|---|---|---|
| `postgres` | superuser | Bootstrap only: creates roles and databases. |
| `lumbung_owner` | LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE | Owns the database, schema `lumbung` and every object in it. Runs migrations, seed and reset. Bypasses RLS because it owns the tables (no `FORCE RLS`). |
| `lumbung_app` | LOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, never a member of the owner | Web process and worker. Subject to RLS, narrow grants and function EXECUTE grants. |

`createDatabase` does the following:
- revokes `CONNECT`/`TEMP` on the database from `PUBLIC`
- grants `CONNECT` to the app
- creates schema `lumbung` owned by the owner
- sets `search_path = lumbung, pg_temp` for both roles in that database
- sets the database `timezone` to `UTC`. Supabase runs UTC; never depend on the machine's TZ (+08 here).

## Migrations (`src/db/migrate-lib.ts`)

- Files are named `db/migrations/NNNN_snake_name.sql` and applied in version order. Each file runs in **one transaction**, under `SET LOCAL search_path = lumbung, pg_temp`, as `lumbung_owner`.
- Applied files are tracked in `lumbung.schema_migrations(version, name, checksum, applied_at)`. The checksum is sha256 of the raw file bytes.
- **Never edit an applied migration.** The runner refuses a changed checksum, a renamed file or a missing file. Add a new file instead.
- Concurrent runners on one database serialise on an advisory lock. Bootstrap uses another lock.
- Number ranges per stage: S1 0001–0019 (W2-FLO owns 0013), S2 0020–0039, S3 0040–0059, S4 0060–0079, S5 0080–0099. Ranges can land out of order on a long-lived dev database. By default this is allowed with a warning; `strictOrder` makes it an error.
- Portability lint (`tests/db/migrations.test.ts`):
  - no `CREATE ROLE`, `USER`, `EXTENSION` or `DATABASE`
  - every created table, function, view or type is qualified with `lumbung.`

| File | Content |
|---|---|
| 0001_schema_helpers | Context getters, `canonical_hash`, capability vocabulary and actor allowlists, append-only trigger function, default privileges (no PUBLIC EXECUTE on future owner functions) |
| 0002_tenancy_security | `tenants`, `users`, `memberships`, `tenant_clocks`, `policy_versions`, `tenant_active_policies`, `activation_decisions`, `idempotency_keys`, `audit_events`, `domain_events`, `tasks`, `flo_access_links`; `tenant_now*`, `require_ctx`, `require_cap`, `has_cap` |
| 0003_reference | `categories`, `products`, `unit_conversions`, `clusters` |
| 0004_flo | `flos` (revision bump trigger), `flo_clusters`, `flo_contacts`, `flo_category_prefs`, `service_schedules`, `category_demands`, `availability_windows`, `flo_category_capacities`, `need_assessments` |
| 0005_agreements | `agreements`, `renewal_tasks`, `agreement_valid_at[_for]`, `agreement_status`, `agreement_is_expiring_soon` |
| 0006_donors_sources_media | `donors`, `donor_contacts`, `source_locations`, `storage_locations`, `media_files` |
| 0007_donations_allocation | `donation_orders`, `donation_items`, `safety_evaluations`, `allocation_runs`, `outreach_campaigns`, `campaign_lines`, `allocations` (INV01 check), `offers`, `reservations`, `reservation_lines`, `transport_arrangements`, `approvals` |
| 0008_delivery_receipts | `deliveries`, `delivery_lines`, `flo_receipts`, `receipt_lines`, `distribution_events`, `distribution_event_lines` |
| 0009_inventory | Inbound and inspection tables, `dispositions`, `inventory_batches`, `stock_movements` / `movement_entries` (zero-sum deferred trigger, append-only), `batch_balances`, adjustments, release plans, picking, recalls, view `v_batch_status` |
| 0010_reporting_comms_jobs | Evidence obligations, submissions, files and reviews; `conversations`, `messages`, `webhook_events`, `outbox`, `jobs`, `worker_heartbeats`, `agent_runs`, `agent_tool_calls`, `simulation_settings` |
| 0011_integration | `external_mappings`, `import_runs`, `import_rows`, `seed_manifests`, `verify_tenant_invariants`, `demo_reset_begin` |
| 0012_rls_grants | RLS and policies, app grants, function EXECUTE lockdown, an index for every foreign key |
| 0013_agreement_commands | (W2-FLO) fixes `agreement_valid_at` for the app role (the 0005 body called the owner-only `_for` variant); FLO/need/agreement command functions; shared internal helpers `lb_raise`, `idem_begin`, `idem_complete`, `append_audit`, `emit_event`, `agreement_json`; S2 hook `on_agreement_revoked` |
| 0014_stage1_integration | `demo_login_directory()` (pre-login demo directory); `GRANT SELECT (version, name) ON schema_migrations` to the app for `/api/health` |
| 0015_agreement_history_ordering | Stage-1 review fixes. Agreements: supersession **caps** a version (`superseded_from`, `superseded_at`, `superseded_by_id`, generated `effective_until`) instead of erasing it — an earlier-starting version stays APPROVED until its successor starts, a fully covered one becomes SUPERSEDED; `LB:AGREEMENT_RESOLUTION_GAP` refuses a resolution that would leave the FLO uncovered now. `agreement_valid_at[_for]` use `effective_until`; new owner-only `agreement_was_valid_at_for` (historical, as recorded at the time: REVOKED before `revoked_at`, capped/SUPERSEDED on the legal interval before `superseded_at`) is used by `verify_tenant_invariants` for HANDOVER/DISPATCH checks. Document interpretation (`document_end_date`, `end_date_interpretation` THROUGH_INCLUSIVE/UNTIL_EXCLUSIVE, `interpretation_note`) — `upload_agreement` now has 9 parameters and requires it. `seq bigint` identity tie-breaker on `audit_events`, `domain_events`, `need_assessments` |

### Conventions

- **Common columns:**
  - `id uuid default gen_random_uuid()`, `tenant_id`, `created_at`, `created_by`, `updated_at` (mutable tables), and `UNIQUE (tenant_id, id)`.
  - Every tenant table has `ON DELETE CASCADE` from `tenants` (protected demo reset).
  - Revisioned aggregates add `revision`.
- **Composite FKs** `(tenant_id, x_id) → parent(tenant_id, id)` everywhere, so a row can never reference another tenant's row.
  - `users` is global. Human actor columns reference `users(id)`.
  - Migration 0012 creates an index for every foreign key that is not already covered by an index (`<constraint>_fkx`).
- **Enums** are `text` with `CHECK (... IN ...)`. Columns whose values the architecture does not fix stay free text and are validated in TS:
  - `categories.perishability`, `flos.service_model`, `donors.kind`, `release_plans.state`
  - `dispositions.kind`/`source_type`, `flo_receipts.time_source`, `donation_orders.reporting_state`
  - `evidence_obligations.anchor_kind`, messaging `status`/`intent`
- **Quantities** are `numeric(14,3)` (> 0 on lines). COUNT lines must be whole (`unit_kind` is denormalised).
- **Money** is integer IDR plus `currency char(3) default 'IDR'`.
- **Days of week** use ISO numbering, 1 = Monday … 7 = Sunday.
- **`activation_decisions.key`** (PRD §27) must be one of:
  - `REGISTRY_SOURCE_OF_TRUTH`, `WAREHOUSE_STOCK_CONTRACT`, `EVIDENCE_DEADLINE_POLICY`, `SAFETY_PROFILES`, `NEED_SCORING`
  - `COURIER_FEE_PROCESS`, `CONTACT_PERMISSIONS`, `MEDIA_POLICY`, `APPROVAL_ROLES`, `HOSTING_OPERATIONS`
- **Agreements:**
  - `valid_from = from_date 00:00` and `valid_until_exclusive = (through_date + 1) 00:00`, both in the tenant time zone.
  - Lifecycle is derived by `agreement_status(a, t)`, which returns one of:
    - `PENDING_VERIFICATION`, `REJECTED`, `REVOKED`, `SUPERSEDED` (the review outcome)
    - `SCHEDULED`, `ACTIVE`, `EXPIRED` (for approved agreements, depending on `t`)
  - `EXPIRING_SOON` is a badge: `agreement_is_expiring_soon(a, t)` is true when the agreement is ACTIVE and `valid_until_exclusive - t <= 30 days`.
- **Batch status** is derived by the view `v_batch_status`, which uses `security_invoker` and the tenant clock. Precedence: RECALL_HOLD > QUARANTINED > DEPLETED > EXPIRED > FULLY_RESERVED > PARTIALLY_RESERVED > AVAILABLE.
- **Append-only tables:** `audit_events`, `domain_events`, `stock_movements`, `movement_entries`.
  - UPDATE and TRUNCATE are always refused (`LB:APPEND_ONLY`), even for the owner.
  - DELETE works only while the transaction-local `lumbung.reset_tenant` setting equals the row's tenant. That setting is only set by `demo_reset_begin`.
  - The app role has no DML on these tables at all.

## Context, capabilities and the clock

`withTx` (src/db/tx.ts) sets these per transaction with `set_config(..., true)`: `app.tenant_id`, `app.user_id`, `app.actor_kind` (`USER|WORKER|AGENT|FLO_LINK|SYSTEM`), `app.link_id`, `app.correlation_id`.

- `current_tenant()` / `current_user_id()` / `current_actor_kind()` / `current_link_id()` / `current_correlation_id()` / `current_actor()`. Without a context, every RLS policy hides every row, so the app fails closed.
- `require_ctx()` returns the tenant id. It raises `LB:CONTEXT_REQUIRED` when the tenant is missing or unknown, the actor kind is invalid, or a FLO_LINK has no link id. It raises `LB:FORBIDDEN` when a USER has no ACTIVE membership.
- `require_cap(cap)` never trusts a capability GUC:
  - USER: an ACTIVE membership whose `capabilities` contains `cap`.
  - FLO_LINK: the link must belong to this tenant, be unrevoked and unexpired by the tenant clock, and list `cap` in its `actions` (only `offer.respond`, `transport.edit`, `delivery.receive`, `evidence.submit` are possible).
  - WORKER / AGENT / SYSTEM: the fixed `actor_kind_allowlist(kind)`. It never includes `agreement.review`, `outreach.approve`, `dispatch.approve`, `inventory.quarantine_release`, `need.confirm`, `policy.manage` or `evidence.excuse`.
  - An unknown capability raises `LB:UNKNOWN_CAPABILITY`.
  - `has_cap(cap)` is the non-raising variant for UI disabled reasons.
- **Known limitation:** anyone holding the `lumbung_app` credential can forge `app.user_id`. Without per-user DB roles this is inherent. Credentials stay server-side. On Supabase this maps to `auth.uid()` later.
- `tenant_now()` reads `tenant_clocks` for the current tenant:
  - FROZEN returns `sim_anchor`.
  - TICKING returns `sim_anchor + (now() - real_anchor)`.
  - REAL (or no row) returns `now()`.
  - `tenant_now_at(tenant)` and `tenant_now_for(clock_row)` are for worker loops and views.
  - Commands never take a caller "now".
- `known_capabilities()` is the SQL copy of `src/shared/capabilities.ts` (G.3). To add a capability, use a migration that replaces it. `memberships.capabilities` and `flo_access_links.actions` are CHECKed against it.

## RLS and grants (0012)

- `apply_tenant_rls(table)` is owner-only and idempotent. It applies `ENABLE ROW LEVEL SECURITY`, then `CREATE POLICY t_iso ... TO lumbung_app USING (tenant_id = (SELECT lumbung.current_tenant())) WITH CHECK (same)`, then `GRANT SELECT`. Migration 0012 runs it for every table that has `tenant_id`. **Later stages must call it for each new tenant table.**
- Special policies:
  - `tenants`: `id = current_tenant()`.
  - `users`: visible through a membership in the current tenant.
  - `category_demands` / `need_assessments`: a SELECT policy, plus an INSERT policy that only allows `status = 'PROPOSED' AND confirmed_by IS NULL`.
  - `worker_heartbeats`: global, read-only, `USING (true)`.
- There is no FORCE RLS. The owner, and therefore every SECURITY DEFINER function, bypasses RLS. Such functions **must** filter with `tenant_id = current_tenant()` themselves.
- The app gets SELECT on everything except `idempotency_keys`, `flo_access_links` and `schema_migrations` (0014 adds a column grant on `schema_migrations(version, name)` only; `checksum`/`applied_at` stay owner-only).
- Direct writes for the app (column lists keep state, revision, verification and confirmation columns out):

| Table | INSERT | UPDATE |
|---|---|---|
| donation_orders, donation_items | — (0023 revokes Stage 1 draft grants) | — (audited commands only) |
| flos | profile columns (not tenure/revision) | profile columns; trigger bumps `revision` |
| flo_contacts, flo_clusters, availability_windows | yes | yes |
| service_schedules | declared columns | declared columns (not verified_*) |
| category_demands, need_assessments | proposals only (no status / confirmed_by) | — |
| media_files | metadata (not deletion_state / duplicate flag) | — |
| messages | yes (not approved_by) | — |
| tasks | yes | state/assignee/due/payload/resolution |
| allocation_runs | — (0023; save_direct_run only) | — |
| expected_inbounds, inbound_lines | yes (state stays EXPECTED) | — |
| import_runs, import_rows | yes | summary / parsed fields (not state) |

- No DELETE or TRUNCATE anywhere. Everything else, including approvals, agreements, allocations, offers, reservations, the ledger, receipts, evidence, audit and events, outbox, jobs, memberships, clocks and policies, is written only by SECURITY DEFINER command functions (S2+). This is verified by `tests/db/direct-write-denial.test.ts` (AC41).

## Function permissions

Every function has `REVOKE ALL ... FROM PUBLIC`. Default privileges also remove PUBLIC EXECUTE from future owner functions. EXECUTE is granted to `lumbung_app` only for the functions listed below. Every SECURITY DEFINER function must use `SET search_path = lumbung, pg_temp`, call `require_ctx()` (directly or via `require_cap`), and filter by `current_tenant()`. `tests/db/rls-catalog.test.ts` checks all of this from the catalog.

| Function | Security | app EXECUTE | Notes |
|---|---|---|---|
| `current_tenant/current_user_id/current_actor_kind/current_link_id/current_correlation_id/current_actor()` | invoker | yes | GUC getters |
| `canonical_hash(jsonb)` | invoker | yes | single hash implementation |
| `known_capabilities()`, `actor_kind_allowlist(text)` | invoker | yes | immutable vocabularies |
| `tenant_now()`, `tenant_now_at(uuid)`, `tenant_now_for(tenant_clocks)` | invoker | yes | tenant clock |
| `require_ctx()` | invoker | yes | context guard |
| `require_cap(text)`, `has_cap(text)` | **definer** | yes | reads `flo_access_links` |
| `agreement_valid_at(uuid, timestamptz)` | invoker | yes | current tenant (body inlined in 0013; the 0005 version failed for the app with 42501) |
| `agreement_status(agreements, timestamptz)`, `agreement_is_expiring_soon(...)` | invoker | yes | derived lifecycle |
| `agreement_valid_at_for(uuid, uuid, timestamptz)` | invoker | **no** | explicit tenant (owner/seed); effective interval (0015) |
| `agreement_was_valid_at_for(uuid, uuid, timestamptz)` (0015) | invoker | **no** | explicit tenant; historical coverage for `verify_tenant_invariants` |
| `verify_tenant_invariants(uuid)` | invoker | **no** | seed / ops checks |
| `demo_reset_begin(text)` | invoker | **no** | DEMO/TEST tenants only (`LB:RESET_FORBIDDEN`) |
| `apply_tenant_rls(regclass, boolean)` | invoker | **no** | migration helper |
| `tg_append_only`, `tg_flos_bump_revision`, `tg_movement_entries_balanced` | trigger | **no** | |
| `create_flo(...)`, `update_flo_profile(...)` (0013) | **definer** | yes | `flo.edit`; `expected_revision` on update |
| `upload_agreement(...)` (0013; 0015: + `p_document_end`, `p_end_interpretation`, `p_interpretation_note`) | **definer** | yes | `agreement.upload`; end-date interpretation required |
| `approve_agreement(...)`, `revoke_agreement(...)` (0013; approve replaced in 0015) | **definer** | yes | `agreement.review`; overlap needs `SUPERSEDE_PREVIOUS` (caps, never erases; refuses a coverage gap); revoke calls the S2 hook |
| `propose_need(...)` / `confirm_need(...)` (0013) | **definer** | yes | `need.propose` / `need.confirm` |
| `lb_raise`, `idem_begin`, `idem_complete`, `append_audit`, `emit_event`, `agreement_json` (0013) | invoker | **no** | internal helpers, only called from inside definer commands; later stages reuse them (same signatures) |
| `on_agreement_revoked(uuid, uuid, text)` (0020) | invoker | **no** | Cancels undispatched direct commitments, releases holds, invalidates approvals, creates review tasks |
| `demo_login_directory()` (0014) | **definer** | yes | pre-login, DEMO/TEST demo tenants only; **no `require_ctx` by design** (allow-listed in rls-catalog) |
| `direct_command(action, subject, payload, key, hash)` (0021) | **definer** | yes | Fixed action/capability map; staff-only simulated direct commands; no arbitrary state PATCH |
| `direct_features(item, receipt, distribution)` (0022) | **definer** | yes | `allocation.run`; scoped deterministic inputs, including eligibility reasons |
| `save_direct_run(...)` (0022) | **definer** | yes | `allocation.run`; revision/policy-bound snapshots from the server planner |
| `run_direct_due()` (0023) | **definer** | yes | `reservation.release`; USER/WORKER; transactional expiry handlers, retries and terminal tasks |
| `claim_direct_outbox(...)`, `finish_direct_outbox(...)` (0023) | **definer** | yes | `message.send`; recheck scope/expiry; wall-clock send leases; unknown outcome never blindly resent |
| `advance_direct_clock(...)` (0023) | **definer** | yes | `demo.clock`; DEMO/TEST only; HTTP route also runs due handlers |
| `direct_worker_heartbeat(...)` (0023) | **definer** | yes | WORKER + `message.send`; operational heartbeat only |
| `revise_direct_item(...)` (0024) | **definer** | yes | `donation.validate`; no live commitments; resets safety to PENDING and invalidates outreach approval |
| `direct_policy`, `direct_eligibility`, `direct_travel`, `direct_window_open`, `direct_remaining_capacity`, `direct_dispatch_hash`, `direct_release`, `refresh_direct_order`, `lock_direct_recipient`, `direct_create/validate/campaign/approve_outreach/start/respond/transport/approve_dispatch/dispatch/receive` | invoker | **no** | Internal helpers, callable only inside the capability-checked command boundary |

Later stages append their command functions to this table: the capability, the lock steps, and app EXECUTE yes or no.

### `verify_tenant_invariants(tenant)` codes

The function returns 0 rows when the tenant is healthy. The seed requires 0 rows.

| Code | Meaning |
|---|---|
| `CLOCK_MISSING` | DEMO/TEST tenant without a clock |
| `AGREEMENT_INTERVAL_MISMATCH` | instants do not match the legal dates in the tenant time zone |
| `AGREEMENT_OVERLAP` | two APPROVED agreements of one FLO overlap |
| `HANDOVER_AGREEMENT_INVALID` | current receipt with no covering agreement and no `AGREEMENT_EXPIRED_AT_HANDOVER` task |
| `DISPATCH_AGREEMENT_INVALID` | delivery not covered at `dispatched_at` and no exception task |
| `RECEIPT_EXCEEDS_DISPATCHED` | Σ current accepted+rejected exceeds the dispatched quantity |
| `RECEIPT_OBLIGATION_MISSING` | receipt without both a BAST and a RECEIPT_PHOTO obligation |
| `FINAL_APPROVAL_MISSING` | DISPATCHED+ allocation without a non-invalidated FINAL_DISPATCH approval |
| `OUTREACH_TRACE_MISSING` | DISPATCHED+ allocation without an OUTREACH approval on its campaign or a MANUAL_ALLOCATION approval |
| `DIRECT_ROUTE_STOCK` | batch from a DIRECT order, batch line on a DIRECT delivery, or batch reservation for a direct item |
| `BALANCE_MISMATCH` | `batch_balances` differs from Σ `movement_entries` per (batch, account) |
| `NEGATIVE_BALANCE` | a physical account is below zero |
| `ITEM_OVERCOMMITTED` | Σ ACTIVE/CONSUMED reservation lines exceeds the item quantity |
| `NEW_FLO_HAS_HISTORY` | tenure NEW FLO with receipts or offers before the latest seed manifest clock |

## Global lock order (commands, S2+)

Preferred resource ordering for new commands is below. `lock_ids(table, uuid[])`
runs `ORDER BY id FOR UPDATE`. Uuid order equals lowercase hex order.
Direct starts lock their source and all candidate capacity rows (ordered by id),
then recheck availability. Recipient profile/agreement shared locks prevent a
concurrent approval/revocation from passing an unchecked operational boundary.
Agreement review begins with the agreement lock; conflicts with dispatch may
therefore deadlock and use the bounded transaction retry below. Never retry a
provider call within a stock transaction.

1. `donation_items` / `inventory_batches` (by id). FEFO locks the candidate set by id first, then picks in memory.
2. `flo_category_capacities` (flo_id, category_id)
3. `outreach_campaigns`
4. `allocations`
5. `offers`
6. `reservations`
7. `deliveries`
8. `evidence_obligations`

Retry `40P01` and `40001` at most 3 times, with jitter (`withTx`).

## Errors

Raise errors with `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:<CODE>', DETAIL = <json text>`. S1 codes are `CONTEXT_REQUIRED`, `FORBIDDEN`, `UNKNOWN_CAPABILITY`, `APPEND_ONLY`, `RESET_FORBIDDEN` and `LEDGER_UNBALANCED`. Privilege failures from direct writes surface as SQLSTATE `42501`.
