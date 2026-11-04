# Lumbung

Lumbung is a food-redistribution coordination app for the FoodCycle Indonesia pilot
(Jabodetabek). It helps staff decide which recipient organisations (FLOs) should
receive donated food, based on verified agreements, need, capacity, responsiveness and
reporting performance, and records every decision for audit.

The product spec is `docs/PRD_v2.md` and the implementation design is
`docs/architecture.md` (both kept locally). The UI is in Bahasa Indonesia by default,
with English available. All times are shown in WIB (Asia/Jakarta).

**Status: the persistent P0 simulation covers all five development stages.**

- 200 deterministic FLOs, verified schedules/demand/capacity, agreement versions,
  private document upload, approval, revocation and renewal tasks.
- Direct donations and warehouse inbound/outbound, deterministic recommendations,
  explained scores, two approvals, scoped FLO links and transport/fee confirmation.
- Inspection splits, FEFO holds, picking, balanced stock transfers, returns,
  independent stock/receipt correction approval, recall and disposal.
- Receipt/distribution evidence, private uploads, calendar or rolling H+1 policies,
  review versions, exemptions, reminders and unknown-distribution escalation.
- Simulated conversations, ambiguity clarification, human takeover, durable jobs,
  outbox recovery, audit, CSV preview/commit/export and external identity mapping.
- Pilot policy versions, membership capabilities, operational metrics, category
  fairness diagnostics, paginated lists and one bundled font across the app.

Live messaging, model and registry integrations remain disabled. FoodCycle's
production decisions in PRD §27 are required before live activation; the demo
runs without paid services or real partner data.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- PostgreSQL 17 through `pg`, with `embedded-postgres` for local development and tests
- zod 4, date-fns with `@date-fns/tz`, vitest 4, Playwright

## Getting started

```bash
npm install
cp .env.example .env.local     # the defaults work for local DEMO mode

npm run db:start               # foreground: embedded Postgres in .data/pg on port 54329
# in a second terminal:
npm run db:setup               # roles + database, migrations, deterministic demo seed
npm run dev                    # http://localhost:3000, then sign in at /masuk
# in a third terminal:
npm run worker                 # durable expirations + simulated message processing
```

- `npm run db:reset` deletes and re-seeds the demo tenant (DEMO/TEST only).
- The seed uses seed 20261026 and a tenant clock frozen at 2026-10-26 08:00 WIB.
- It compares its row counts against `db/seed/expected-manifest.json`.
- Existing installations: run `npm run db:migrate` before restarting the app and worker.
  No reset is necessary to apply the new commands.
- Set `APP_BASE_URL` to the exact browser origin, including hostname and port; demo
  sign-in checks it. `localhost` and `127.0.0.1` are different browser origins.
- The worker defaults to the seeded demo tenant. Set `WORKER_TENANT_ID` when running
  another tenant. `npm run worker -- --once` runs one tick and exits.
- `/api/health` checks the web/database schema; `/api/health/worker` checks whether a
  worker heartbeat has arrived in the previous 60 wall-clock seconds.

## Roles and modes

- **`lumbung_app`** is the role the web process and worker use. Row-level security applies to it, so it sees only its tenant's data.
- **`lumbung_owner`** is used only by migrations, the seed and reset. It owns the schema.
- **`APP_MODE`** is `DEMO`, `TEST` or `LIVE`.
  - In DEMO and TEST, the mock messaging adapter is always used.
  - LIVE refuses dev secrets, the owner and admin DB URLs in the web process, demo tenants and demo sign-in.

## Scripts

| Script | Purpose |
|---|---|
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / eslint |
| `npm test` | Unit tests (`tests/unit`, TZ=UTC) |
| `npm run test:db` | DB, API and scenario tests against real Postgres. Reuses the server on 54329 if one is running, otherwise starts its own; every run gets its own `lumbung_test_*` database |
| `npm run test:e2e` | Builds production, creates/seeds a temporary test database, starts an isolated web server and worker, tests desktop/mobile Chromium, then removes its database. Needs `npx playwright install chromium`. Does not reset the developer database |
| `npm run db:rehearse-backup` | Private DEMO/TEST database snapshot and disposable restore/invariant rehearsal |
| `npm run test:all` | Unit, database and isolated browser suites |
| `npm run build` / `npm start` | Production Webpack build and server. Webpack is selected because Turbopack's CSS subprocess failed to bind a local port in the restricted development environment |

## Layout

| Path | Contents |
|---|---|
| `db/migrations` | SQL migrations (append-only; applied files are checksummed) |
| `db/README.md` | Roles, grants and the function permission table |
| `db/seed` | Deterministic seed generator |
| `src/domain` | Pure domain logic: agreement intervals, hours, demand, units, deadlines |
| `src/application` | Read models and command wrappers that run inside `withTx` |
| `src/db`, `src/http`, `src/security`, `src/i18n` | Infrastructure |
| `app/(ops)` | Staff pages: dashboard, FLOs, donations, recommendations, approvals, inventory, deliveries, inbox, reporting, settings and audit |
| `app/api` | Route handlers |

## Direct donation walkthrough

1. Sign in as **Koordinator Demo 1**, open **Donasi → Donasi baru**, and choose
   Toko Roti Simulasi Sunter / SRC-001 / Roti Tawar. The defaults offer 120 portions
   from 08:00–11:00 WIB, ready at the frozen clock, for distribution before 14:00 WIB.
2. Save, then **Validasi keamanan**. Missing preparation or label facts produce review
   reasons; correct the recorded facts and validate again. Safety is synthetic and LIVE is blocked.
3. Set arrival/distribution times and **Hitung rekomendasi**. Inspect the factors and
   exclusions: FLO-0001 has an expired agreement and cannot enter an executable plan.
4. Select up to three eligible FLOs and quantities. For SC01 select FLO-0003 with 60
   and FLO-0004 with 40, enter a reason, and **Ajukan outreach**. The other 20 remain
   visible on the donation. Approve the outreach, then start the simulated offers.
5. Record a simulated accept, partial accept or decline. Holds resize on partial
   acceptance. Fee refusal releases the reservation and creates a logistics task;
   it does not penalise responsiveness or reporting.
6. Confirm the actual collection arrangement and FLO agreement to any IDR courier
   fee. Enter a reason for **Setujui pengiriman**, open the delivery, and record pickup
   with its custodian. Pickup rechecks the agreement, food window, reservation and approval.
7. Record the FLO's receiving checks for smell, appearance, texture, packaging and,
   only when appropriate, taste, together with actual accepted/rejected quantities.
   Any inspection concern must reject the affected receipt quantity and include an
   observation; discrepancies create staff tasks.
   BAST and receipt-photo obligations stay visible independently of physical receipt.

Urgent reservations last 15 simulated minutes. **Pengaturan → Majukan waktu** uses
the same handlers as the worker. Expired offers cannot be resurrected. Use
`npm run db:reset` to restore the synthetic dataset; reset is intentionally an owner CLI operation; the web process does not reset the database. Never use the reset command against a live tenant.

The database suite covers permissions, seed/reset determinism, direct and warehouse
source races, capacity locks, partial acceptance, stale approvals, correction
history, FEFO, reporting, CSV identity mapping and job/provider recovery. Browser
checks cover desktop and 390 px mobile journeys, FLO evidence submission and staff
review, warehouse receiving, layout, font consistency and an axe scan.

## Reporting and communications walkthrough

1. Complete a direct or warehouse receipt. Physical delivery and reporting stay
   separate. Open **Pengiriman** for BAST, receipt photos and actual distribution.
2. A coordinator can create a private FLO link on an allocation or delivery. Open
   it on mobile: it exposes only that subject's permitted actions and expires on
   the tenant clock. Share it only with the verified FLO contact.
3. Upload JPEG/PNG/PDF evidence (maximum 10 MB) or record an assisted explanation.
   Images lose unnecessary EXIF/text metadata; downloads require scoped access.
   An explanation is submitted for review, not automatically accepted as a signature.
4. Switch to **Peninjau Bukti Demo** and open **Pelaporan**. Review the latest
   submission against all three adequacy checks. A timely adequate submission
   stays on time even when staff review it later. Clarification creates another
   immutable submission version. An exemption requires a category and reason.
5. Record each actual distribution separately, including quantity, loss, remaining
   food and optionally reported consumption. People are event reports, not unique
   beneficiaries. Each event receives its own evidence obligation.
6. In **Pesan**, simulate a verified contact's message. An ambiguous `ya` with two
   open offers asks for a reference. Explicit offer references can accept/partially
   accept/decline. Unknown contacts and privilege requests go to staff triage.
7. Take over a conversation to pause queued agent replies. Send as its assigned
   operator; resume only with a handover summary. Run the worker and advance the
   clock in **Pengaturan** to process expirations and reminders.

## Warehouse walkthrough

1. Sign in as **Gudang Demo 1**. **Persediaan → Catat rencana inbound** records
   expected stock only. Receive and inspect the physical arrival. For SC04, record
   100 packs as 80 usable, 15 held and 5 rejected, with storage, lot and label facts.
2. Sign in as a coordinator. Plan a release for the warehouse/product, proposed
   quantities and service times. Review the same candidate factors and exclusions
   as a direct donation. The plan uses cleared available stock, not expected stock.
3. Draft and approve outreach, start backed offers, record FLO acceptance and
   transport/fee confirmation, then approve final dispatch.
4. Switch to warehouse staff and open the delivery's pick list. Record every
   actual picked quantity; substitutions must use a compatible cleared batch.
   Quantity changes require renewed FLO confirmation and dispatch approval.
5. Dispatch transfers reserved quantities to transit. FLO receipt records each
   batch's actual outcome. Returns enter quarantine after physical arrival.
6. Batch details show immutable ledger entries. Count corrections require a private
   count document and a different supervisor to approve. A receipt correction
   preserves the old receipt and replaces its fairness contribution. Supervisors
   can recall stock or record an approved disposal with a reason.

## CSV and source of truth

**Pengaturan → Impor / ekspor CSV** accepts UTF-8 CSV, at most 2 MB / 2,000 rows.
Preview shows row errors and duplicates before commit. Supported kinds are FLOs,
donation drafts and historical receipts. A stable `(system, entity_type, external_id)`
identifies an imported fact. Same fact/revision replays are skipped; changed facts
become conflicts. Include `local_receipt_id` to correlate an external record with
an already recorded local receipt. Warehouse history must identify its donor;
it does not fabricate a physical stock receipt.

| Fact | Authority in the standalone demo | Import/live boundary |
|---|---|---|
| FLO profile, confirmed need, schedules and capacity | Staff-reviewed local revisions | Imported profiles begin unverified; no external authority assumed |
| Legal agreement | Uploaded document and authorised review, with legal dates | Upload alone never extends eligibility |
| Stock | Inspected physical receipts and immutable balanced movements | Expected/imported deliveries cannot create available warehouse stock |
| Accepted food and fairness | Current receipt lines, with correction history | External identity mapping prevents replayed contributions |
| Evidence and timeliness | Submission occurrence/time plus human review and bound policy | Provider delivery status is not recipient acceptance or evidence approval |
| Contact permission | Verified contact, recorded consent/opt-out and takeover state | Existing partner status is not permission for live messages |
| Live activation | FoodCycle decisions and separately approved operational adapters | No production system/API contract is inferred from screenshots |

Example historical receipt CSV:

```csv
external_id,flo_code,product_code,source_code,route,quantity,unit,received_at,local_receipt_id
external-001,FLO-0003,ROTI-TAWAR,SRC-001,DIRECT,9,portion,2026-10-24T03:00:00Z,
```

Mutations use a signed session or scoped FLO token, `Idempotency-Key`, strict
request schemas and a `data`/`error` envelope with `correlation_id`. Mutable
aggregates also require `expected_revision`. For example:

```http
POST /api/obligations/{id}/submissions
Idempotency-Key: evidence-attempt-001
Content-Type: application/json

{"expected_revision":1,"note":"Assisted handover description for review","media_ids":[]}
```

Binary upload uses `POST /api/uploads` with `x-subject-id`, `x-upload-purpose`
(`EVIDENCE`, `AGREEMENT`, `COUNT`), the actual MIME type and an idempotency key.
FLO clients additionally send `x-flo-token`. Media remains outside `public/`.
`GET /api/media/{id}` authorises a short-lived scoped download URL; access is audited.
The mock webhook requires an HMAC over its raw body and is disabled for live tenants.

## Backup rehearsal and operational limits

Run `npm run db:rehearse-backup` against the local synthetic tenant. It takes a
consistent private JSON database snapshot, restores it into a fresh disposable
database, checks every table count and tenant invariant, and drops the scratch
database. It preserves exact SQL dates, microsecond timestamps, bytea and identity
sequences. The source database is read only. Artifacts are private under
`.data/backups/` and ignored by Git. This needs the local database admin connection.

The rehearsal covers database recovery. Back up `MEDIA_DIR` and encryption keys
separately, and configure managed database/PITR backups before production. Seed
media records are synthetic references; they do not contain real agreement photos.

The P0 assistant uses deterministic intent parsing and bounded typed tools. A live
Gemini/Fonnte/registry adapter is not enabled by setting credentials. Production
hosting, real authentication, operational performance/SLA measurements, native
backup/PITR and FoodCycle's legal/safety/contact/retention decisions remain live
activation work. Media retention is enforced for uploaded files; contact/message
retention settings must be approved and operationalised for real personal data.
No photo face counting, carbon savings or cross-organisation unique-person claims
are made.

### In-app walkthrough and readable lists

After signing in, choose **Mulai panduan** (English: **Start walkthrough**) above the page heading. The guided tour scrolls to individual fields, records, and actions, dims the surrounding page, and points to each highlighted control with a short explanation. You can type into highlighted fields and open records normally. Opening a different screen pauses the tour; choose **Tampilkan sorotan** to return, or **Berikutnya** to continue. The tour follows your role’s navigation and remembers the current step for the browser tab. Press **Esc** or the close button to exit. Missing records and unavailable approval actions are explained without inventing a target. Finishing the tour marks the explanation as read; the tour never creates or approves operational records.

Donations, deliveries, inventory, conversations, and reports have searchable lists with status filters. Search and filters apply to the current page of results; use pagination to browse further. Quantities use the selected language’s decimal separator and omit redundant trailing zeros. Stock balances remain distinct from food-safety eligibility; expand a batch’s balances or open its detail to inspect the full record.
