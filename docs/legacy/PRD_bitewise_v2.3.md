# Bitewise — Product Requirements Document

**Product:** Bitewise
**Customer (in-product):** Willing Hearts (fictional/demo Singapore food-redistribution charity)
**Status:** Built, live-tested, hackathon-ready
**Doc version:** 2.3 — 2026-08-12
**Owner:** Radoslaw Aryananda

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Users & Personas](#4-users--personas)
5. [System Overview](#5-system-overview)
6. [Feature Specification](#6-feature-specification)
7. [Matching Algorithm Specification](#7-matching-algorithm-specification)
8. [AI Agent Architecture](#8-ai-agent-architecture)
9. [Data Model](#9-data-model)
10. [API Specification](#10-api-specification)
11. [Page-by-Page Specification](#11-page-by-page-specification)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Tech Stack](#13-tech-stack)
14. [Metrics & KPIs](#14-metrics--kpis)
15. [Known Limitations & Risks](#15-known-limitations--risks)
16. [Out of Scope / Future Work](#16-out-of-scope--future-work)
17. [Glossary](#17-glossary)
18. [Appendix: Environment & Deployment](#18-appendix-environment--deployment)

---

## 1. Executive Summary

Bitewise is a web application that simulates the software a real food-redistribution charity would run internally to route surplus food donations across its own branch network. The in-product customer is **Willing Hearts**, operating **5 branches** across Singapore (Woodlands, Toa Payoh, Bukit Merah, Yishun, Tampines).

The core problem Bitewise solves is **intra-network routing**: given a donation (what food, how much, how urgently it spoils, where it's coming from), which of the charity's own branches should receive it? The answer has to balance three competing concerns — how far the donation has to travel, how much spare capacity a branch has relative to its size (fairness), and whether a branch already has a glut of that same food type about to spoil (waste prevention).

Bitewise answers this with a **two-layer decision system**:

- A transparent, auditable **deterministic scoring formula** that always produces an answer, instantly, with no external dependency.
- A **genuine multi-agent AI layer** (real Gemini function-calling tool use, not simulated) that adds judgment on top of the deterministic scores — able to deviate from the raw top score when the evidence justifies it — with the deterministic formula as an always-available safety net if the AI is unavailable or errors.

The product has two audiences, reflected as two distinct UI surfaces:

- **NGO View** — the internal tool Willing Hearts staff use to run the network: approve/reject donations, watch fairness and inventory in real time, and audit every AI decision after the fact.
- **Public View** — the public-facing surface: businesses (hotels, restaurants, supermarkets, factories) submit surplus food; anonymous members of the public browse and claim available food near them.

Nothing reaches a branch automatically. Every donation — whether simulated internally or submitted publicly — sits in a **Pending Approvals** queue until a Willing Hearts staff member explicitly approves it.

---

## 2. Problem Statement

Charities that operate multiple branches/warehouses face a distribution problem that's easy to get wrong in an ad-hoc way:

- **Proximity bias**: without a system, donations tend to go to whichever branch is easiest to reach, regardless of whether that branch actually needs more stock.
- **Fairness erosion**: some branches (often the ones with the best relationships or the most staff capacity) end up chronically over-supplied while others are chronically under-supplied, even though total network-wide donation volume looks healthy.
- **Invisible spoilage risk**: a branch can look "under capacity" by weight while actually being glutted with one specific food type that's about to expire — sending more of the same food type there just accelerates waste, not rescue.
- **No transparency**: when routing decisions are made by a person's gut feel or a simple "nearest branch" rule, there's no record of *why* a decision was made, which makes it hard to audit, improve, or defend the process to donors, funders, or regulators.
- **No governance**: donations that get auto-committed the moment they're logged leave no room for a human to catch a bad match (e.g., a branch with no cold storage being assigned a dairy donation) before it becomes a wasted pickup trip.

Bitewise addresses all five: a defined scoring formula for proximity/fairness/spoilage, a fully transparent per-decision audit trail (including, where AI is involved, the AI's own reasoning), and a mandatory human-approval gate before anything is committed.

---

## 3. Goals & Non-Goals

### Goals

- G1. Given a donation's location, food type, quantity, and urgency, recommend the best-fit Willing Hearts branch using a transparent, explainable formula.
- G2. Make every routing decision — algorithmic or AI-assisted — fully auditable after the fact, including the AI's own natural-language rationale where applicable.
- G3. Never auto-commit a donation to a branch without explicit NGO staff approval.
- G4. Provide a genuinely agentic AI layer (real tool-calling, real autonomous decision-making) that can improve on the deterministic formula's raw ranking when the evidence supports it — while never being a single point of failure for the live donation flow.
- G5. Give the public two simple entry points — donate surplus food, or browse/claim available food — with no login required.
- G6. Model realistic operational nuance: branches vary in capacity and capability (not all have cold storage or cooking facilities), inventory expires and must be tracked, and near-expiry unclaimed stock needs a fallback distribution path.
- G7. Track cross-cutting impact metrics (kg rescued, meals-equivalent, CO₂ avoided, network fairness) so the system's value is demonstrable, not just its plumbing.

### Non-Goals (for this version)

- NG1. Real payment, logistics dispatch, or courier integration — pickup/delivery is modeled as a status field, not an actual dispatch system.
- NG2. Authentication, authorization, or role-based access control — see [Known Limitations](#15-known-limitations--risks).
- NG3. Multi-charity / cross-organization routing — Bitewise only routes within one charity's own branch network.
- NG4. A general-purpose RAG/vector-search pipeline for food-safety knowledge — the domain is small enough (8 food categories) that a hand-authored lookup table is deliberately used instead.
- NG5. Production-grade scale — the matching algorithm and agent pipeline are tuned for a small number of branches (5) and a demo-level request volume, not hundreds of branches or high concurrent throughput.

---

## 4. Users & Personas

| Persona | Surface | Needs |
|---|---|---|
| **NGO Operations Staff** (Willing Hearts) | NGO View | See the whole network's state at a glance; approve/reject incoming donations quickly with confidence in the suggested match; understand *why* the system suggested a branch; track donor relationships over time; know what's sitting in inventory and how urgently it needs to move. |
| **Corporate/Business Donor** (hotel, restaurant, supermarket, factory) | Public View → `/donate` | Post a surplus-food listing in under a minute, from a phone, with no account; get an instant, standardized food-safety verdict on their declared storage/expiry before it's ever queued for staff; know their donation won't be wasted or misused (guidelines agreement). |
| **Public Recipient** | Public View → `/recipient` | Browse what food is currently available and where with zero personal data collected; claim an item with just a name, no account, and see exactly how long they have to collect it. |
| **Hackathon Judge / Evaluator** | NGO View → `/agents` | Verify that the "AI agent" claim is real — see actual per-branch AI reasoning grounded in real numbers, not a hardcoded script, and see the deterministic fallback that guarantees the system never breaks live. |

---

## 5. System Overview

```
┌─────────────────────────────┐       ┌──────────────────────────────┐
│         Public View          │       │           NGO View            │
│  ┌───────────┐ ┌───────────┐ │       │ ┌──────────┐ ┌──────────────┐ │
│  │ /recipient │ │  /donate  │ │       │ │/orchestrator│ │ /approvals  │ │
│  │  (browse/  │ │  (submit  │ │       │ │ (dashboard)│ │  (approve/  │ │
│  │   claim)   │ │  listing) │ │       │ │            │ │   reject)   │ │
│  └───────────┘ └───────────┘ │       │ └──────────┘ └──────────────┘ │
│                               │       │ ┌──────────┐ ┌──────────────┐ │
│                               │       │ │  /agents  │ │   /donors    │ │
│                               │       │ │ (decision │ │ (relationships)│ │
│                               │       │ │   log)    │ │              │ │
│                               │       │ └──────────┘ └──────────────┘ │
│                               │       │ ┌──────────┐                  │
│                               │       │ │ /storage  │                  │
│                               │       │ │(inventory)│                  │
│                               │       │ └──────────┘                  │
└──────────────┬────────────────┘       └───────────────┬────────────────┘
               │                                          │
               ▼                                          ▼
       ┌───────────────────────────── Next.js API routes ─────────────────────────────┐
       │  /api/listings   /api/claims   /api/inventory   /api/donors   /api/fairness  │
       │  /api/approvals  /api/approvals/[id]/approve|reject   /api/audit             │
       │  /api/food-safety/check                                                       │
       └───────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                        ┌───────────────────┼────────────────────────┐
                        ▼                                            ▼
         ┌──────────────────────────────┐            ┌────────────────────────────────┐
         │   Matching / Agent Pipeline   │            │      Supabase (Postgres)        │
         │  deterministic formula  +     │◄──────────►│  donors, branches, food_listings,│
         │  Branch Coordination Agents + │            │  inventory_items, claims,        │
         │  Network Coordinator Agent    │            │  fairness_snapshots, audit_log   │
         │  (Gemini, w/ deterministic     │            │  + Realtime (branches UPDATE)    │
         │   fallback at every step)      │            │  + Row Level Security             │
         └──────────────────────────────┘            └────────────────────────────────┘
```

**Core principle: propose, don't commit.** Every code path that decides "which branch should get this donation" — the public donate form, the internal Simulate button, the agent pipeline — only ever produces a *suggestion* attached to a `pending` `food_listings` row. The only code path that mutates branch load, creates inventory, or updates donor totals is `POST /api/approvals/[id]/approve`, gated behind explicit staff action.

---

## 6. Feature Specification

### 6.1 NGO View features

| Feature | Description |
|---|---|
| **Network Overview dashboard** (`/orchestrator`) | Live stat cards (kg rescued, meals-equivalent, CO₂ avoided, active deliveries), an interactive Leaflet map of all donors and branches with animated donation routes, a Jain's Fairness Index gauge, per-branch saturation bars, and a "Simulate New Donation" button that generates a randomized realistic donation for demo purposes. |
| **Pending Approvals** (`/approvals`) | Queue of every `pending` food listing (from both the public form and the Simulate button), each showing the full agent transcript (per-branch AI rationale, excluded branches, coordinator synthesis) and Approve / Reject actions. Badge count in the sidebar nav. |
| **Agent Decision Log** (`/agents`) | Permanent, append-only historical record of every *approved* match, with the full transcript preserved exactly as it was at decision time — for audit and demo purposes. |
| **Donor Relationships** (`/donors`) | Grid of every donor who has ever contributed, ranked by total kg donated, with a detail modal showing computed meals-equivalent and CO₂-avoided per donor. |
| **Storage Management** (`/storage`) | Every branch split into **zones** (Frozen / Chilled / Ambient) derived from each item's `storage_type`, with per-zone rack occupancy, modelled holding temperature and health band, plus per-item shelf life and whether the item is publicly listed, reserved, or already escalated to a partner. Flags stock sitting in a zone the branch has no allocation for. |
| **Fleet & Logistics** (`/logistics`) | Every vehicle with its derived live status (idle / assigned / en route / picked up / offline), what it's carrying, which branch it's covering, and whether it's on loan from another branch. Per-branch coverage cards warn when a branch has no free vehicle or no free refrigerated vehicle. Staff advance runs through the lifecycle; a recent run log gives history rather than just a snapshot. |
| **Partner Dispatch** (`/dispatch`) | Escalated food grouped into delivery runs per branch, each item matched to the nearest partner that can genuinely receive it, with a shortest multi-stop route, a load manifest, and a suggested vehicle. Flags runs where the drive alone exceeds the remaining shelf life. |

### 6.2 Public View features

| Feature | Description |
|---|---|
| **Donate Surplus Food** (`/donate`) | Public intake form for any business (no login) to list a surplus-food donation: business identity, pickup address, food details, quantity, spoilage window, and a mandatory guidelines agreement. Every submission passes through the standardized food-safety check automatically (see 6.3/7.7) — a `bad` verdict rejects with an explanation instead of creating anything. Otherwise submission never auto-commits — it creates a `pending` listing awaiting NGO approval, and the donor sees their own safety verdict alongside the confirmation. |
| **Available Near You** (`/recipient`) | Public browse-and-claim view of all `in_stock` inventory across every branch — browsing itself stays fully anonymous, no account ever required just to look. Each listing carries the **full picture**: what the food is, quantity, storage requirement with plain-language handling advice, exact best-before time, the food-safety reference for that category, who donated it — and a **live delivery tracker** showing where it physically is (collection scheduled → driver on the way to collect → collected and in transit → at the branch, ready to collect). Food is listed the moment Willing Hearts approves it, so recipients can reserve ahead of arrival; the action button reads "Reserve for collection" until it's actually on the shelf, then "Claim this item". *Claiming* — not browsing — asks for a name (§7.8), the first time only, then starts a live agent-computed pickup countdown shown right on the card. |

### 6.3 AI-assisted features

| Feature | Description |
|---|---|
| **Matching / Agent Pipeline** | For every new or re-verified donation, decides which branch should receive it. See [Section 8](#8-ai-agent-architecture) for full detail. |
| **Supply Chain Planner Agent** (`GET /api/agents/plan`, SSE) | On-demand from `/approvals` or `/agents`: plans the donation's full journey after routing — pickup, transfer, storage handling, how long to list it publicly, the escalation trigger, and which partner beneficiary absorbs it if unclaimed. Streams its real working steps live, then renders a flow diagram (`donor → branch → storage → listing → contingency → beneficiary`) with timings anchored to the actual spoilage window. See [Section 8.7](#87-supply-chain-planner-agent). |
| **Standardized food-safety verification** (`POST /api/food-safety/check`, also runs server-side inside `POST /api/listings`) | Runs automatically, instantly, on every submission — not an on-demand advisory check anymore. Retrieves the best-matching category from a 12-entry standardized rule corpus (`lib/knowledge/food-safety.ts`), computes a deterministic safety-floor verdict, then asks Gemini for a readable score/reasoning that may only escalate severity, never soften it. `bad` rejects the submission outright before any row is written — the one AI-driven decision in this codebase allowed to block rather than just advise; `warning`/`good` proceed to the branch-matching pipeline with the verdict attached, visible to staff at approval. See [Section 7.7](#77-standardized-food-safety-verification). |
| **Agent-computed pickup countdown** (`lib/agents/pickup-window-agent.ts`, runs inside `POST /api/claims`) | Every claim gets a pickup deadline decided fresh, never a fixed constant: a deterministic urgency-tiered floor, refined by Gemini using the item's real remaining shelf life and, when cached, the donation's own supply chain plan. Miss it and the reservation releases itself on the next `/api/inventory` read. See [Section 7.8](#78-recipient-profiles-and-the-agent-computed-pickup-countdown-v23). |

### 6.4 Operational logic (no dedicated UI, but user-facing in effect)

| Feature | Description |
|---|---|
| **Time-based escalation to partner beneficiaries** | Any `in_stock` inventory item within `ESCALATION_THRESHOLD_HOURS` (3 hours) of its `expiry_at` is lazily flipped to `status = 'escalated'` on the next read of `/api/inventory` (no cron job). Escalated items disappear from the public claim list and are shown on `/storage` as routed to "Partner beneficiaries" — modeling how Willing Hearts actually distributes food once public claiming runs out of runway: direct delivery to known/registered households instead of leaving it to expire unclaimed. |
| **Delivery visibility** | A donation is publicly listed as soon as it's approved, but approval is *not* the same as arrival — a vehicle still has to collect it. Each inventory item joins to its open collection run (via `inventory_items.listing_id`) to derive where the food actually is, so the public list never implies food is on the shelf while the van is still outbound. `received_at` is stamped when the run **completes**, not at approval. Items with no open run — seeded stock, or a donation no vehicle could be assigned to — are reported as at the branch, which is safer than stranding them in permanent transit. |
| **Donor auto-registration** | A first-time public donor is created automatically (`status: 'pending'`) on their first listing submission; their status flips to `'verified'` the moment their first donation is actually approved by NGO staff. Returning donors are matched by name (case-insensitive). |

---

## 7. Matching Algorithm Specification

The deterministic core (`lib/algorithms/matching.ts`) is the foundation both the plain algorithmic path and the AI agent tools are built on — it's the one place the actual arithmetic lives, so the AI's tool calls and the "no AI available" fallback are always guaranteed to agree.

### 7.1 Eligibility

A branch is eligible to receive a donation only if:

```
current_load_kg < capacity_kg
```

Branches at or over capacity are excluded entirely and never scored.

### 7.2 Scoring — three weighted factors

For each eligible branch, three independent 0–1 scores are computed:

**1. Proximity score** — closer branches reduce transit time and in-transit spoilage risk.

```
distance_km = haversine(donor_lat, donor_lng, branch_lat, branch_lng)
proximity_score = 1 / (1 + distance_km × 10)
```

(Haversine formula, Earth radius 6371 km — `lib/utils/geo.ts`.)

**2. Fairness need score** — branches with more free capacity *relative to their own size* are preferred, so a small branch and a large branch are compared on equal footing rather than by raw headroom.

```
saturation = current_load_kg / capacity_kg
fairness_need_score = 1 − saturation
```

**3. Spoilage risk score** — penalizes sending more of a food type to a branch that already has a lot of that *same* type about to expire, which would just create a bigger glut rather than rescuing more food.

```
same_type_expiring_soon = count of that branch's in_stock inventory items
                            where food_type matches AND 0 < hours_until_expiry ≤ 24
spoilage_risk_score = 1 / (1 + same_type_expiring_soon × 0.5)
```

### 7.3 Combined weighted score

```
total_score = 0.3 × proximity_score + 0.5 × fairness_need_score + 0.2 × spoilage_risk_score
```

(`DEFAULT_MATCH_WEIGHTS = { proximity: 0.3, fairness: 0.5, spoilage: 0.2 }`)

Fairness is deliberately weighted highest — the product's stated priority is even distribution across the network over raw travel-time optimization.

Branches are ranked best-first by `total_score`. In the pure deterministic path (no AI), the top-ranked branch is the suggestion. In the AI-assisted path, this ranking is only the *starting point* — see Section 8.

### 7.4 Network-wide fairness metric — Jain's Fairness Index

Separately from per-donation matching, the network's overall load balance is measured continuously via Jain's Fairness Index (`lib/algorithms/jain-fairness.ts`):

```
ratio_i = current_load_kg_i / capacity_kg_i   (per branch i)
J = (Σ ratio_i)² / (n × Σ ratio_i²)
```

- `J = 1.0` → perfectly even relative load across every branch.
- `J → 1/n` → load is maximally concentrated in a single branch.

This is recomputed and snapshotted (`fairness_snapshots` table) on every approval, and shown live on `/orchestrator` as a gauge.

### 7.5 Impact metrics derivation

Displayed on `/orchestrator` and `/donors`, derived directly from committed (`matched`/`in_transit`/`delivered`) kg:

```
meals_equivalent = round(total_rescued_kg × 2)
co2_avoided_kg   = total_rescued_kg × 2.5
```

### 7.6 Demand-quota allocation to partner beneficiaries (v2.1)

Real Singapore food-redistribution charities don't route donations to the public first and a partner organisation second — it's the other way around. Willing Hearts' central kitchen ships by each drop-off point's *registered daily quota*; Food Bank Singapore / Food from the Heart matches its warehouse intake to partner beneficiaries the same way, protected by a fairness index so small/remote partners aren't starved while large agencies soak up everything. Bitewise's v1–v2.0 model only used partner beneficiaries reactively (Section 6.4's 3-hour escalation) — v2.1 makes demand-quota allocation the **primary** channel, run once at approval time, with public listing demoted to the fallback for whatever no eligible partner still has quota room for.

Each partner beneficiary (`lib/data/beneficiaries.ts`) now carries a `daily_quota_kg` — its registered daily demand — alongside its existing eligibility rules (cold-chain, cooked-food acceptance). `lib/algorithms/beneficiary-matching.ts` scores every eligible partner in the matched branch's area:

```
quota_ratio  = fulfilled_today_kg / daily_quota_kg
need_score   = clamp(1 − quota_ratio, 0, 1)
proximity_score = 1 / (1 + minutes_from_branch / 10)

total_score = 0.65 × need_score + 0.35 × proximity_score
```

Need is weighted well above proximity — deliberately the inverse emphasis of Section 7.3's branch matching, because this step models *fairness of access to already-rescued food*, not spoilage-driven logistics. A partner already at or over its declared quota (`need_score = 0`) is never selected, no matter how close it is; the donation falls through to the next-best partner, or to public listing if none has room.

`fulfilled_today_kg` is read from `beneficiary_allocations` (`008_beneficiary_allocations.sql`), summed per partner since UTC midnight. When a match is found, the approval flow (`app/api/approvals/[id]/approve/route.ts`):
1. Records the choice in `decision_details.beneficiary_allocation` (partner, quota, fulfilled-before, need/proximity scores) — visible on `/item/[id]`.
2. Inserts the `inventory_items` row with `status = 'escalated'` instead of `'in_stock'` — reusing the existing enum value rather than adding a new one, since it means the same thing downstream (routed to a partner, not publicly claimable), just reached deliberately at approval time instead of reactively after 3 hours unclaimed.
3. Writes a `beneficiary_allocations` row so the next donation's `fulfilled_today_kg` reflects this one.

The same Jain's Fairness Index maths from Section 7.4 is reused unchanged, one layer downstream — `GET /api/beneficiaries` computes it across every partner's `fulfilled_today_kg / daily_quota_kg`, surfaced on `/dispatch`'s new "Beneficiary Network" panel.

**Graceful degradation:** if `008_beneficiary_allocations.sql` hasn't been run yet, the fulfilment query fails and the approval flow *skips demand-quota allocation entirely for that approval* — it does not treat the failure as "every partner has zero allocations today," which would incorrectly route everything to a partner on fabricated data. It falls back to exactly the pre-v2.1 behavior: public `in_stock` listing, same as before this feature existed.

### 7.7 Standardized food-safety verification (v2.2)

Every submission is checked against a standardized, structured rule corpus before a listing is even created — not the optional, on-demand advisory tool v2.1 and earlier shipped. This is the only AI-driven decision anywhere in Bitewise allowed to **block** a donation outright rather than just advise on it, because the stakes (real foodborne illness risk) are categorically different from a routing choice.

**The corpus** (`lib/knowledge/food-safety.ts`, `FOOD_SAFETY_CATEGORIES`) is 12 standardized categories — cooked high-risk food, dairy, cut/whole fresh produce, plain/dairy-filled bakery, eggs, frozen prepared food, canned goods, dry goods, sealed beverages, and a conservative uncategorized default — each carrying `perishable`, `requires_cold_chain`, and a maximum safe number of hours for ambient / chilled / frozen storage. Thresholds are anchored to two published sources, not guessed:

- **Singapore Food Agency, *Guidelines for Food Donation*:** chilled ≤4°C, frozen ≤-18°C, hot-held >60°C, and a 5°C–60°C temperature danger zone.
- **FDA/USDA:** perishable food unrefrigerated beyond 2 hours (1 hour above ~32°C) is a discard risk; food-service guidance caps cumulative danger-zone time at 4 hours.

**Retrieval.** `retrieveFoodSafetyCategory()` (`lib/algorithms/food-safety.ts`) keyword-matches the donor's free-text item name (and note) against every category, falling back to the declared `food_type` dropdown's own default category only when no keyword matches. This is what makes the standard apply the same way regardless of how an item is worded — a donor who selects the generic "other" dropdown value but types "roast chicken" is still scored as high-risk cooked food, not the conservative default.

**Deterministic floor.** `computeDeterministicVerdict()` divides the declared shelf life by the safe maximum for the declared storage type — a category with no meaningful ambient limit (canned goods, dry goods, sealed drinks) is always `good`. Thresholds: ratio ≤1× → `good`, 1×–2.5× → `warning`, >2.5× → `bad`. 2.5× was chosen so a single honest mistake (e.g. cooked food chilled for exactly its 72h max) still lands at 1×, not past it — only a compounding error crosses into `bad`.

**AI escalation only.** Gemini receives the retrieved category and the deterministic floor verdict, and produces a 0–100 score and plain-language reasoning — but `escalateOnly()` (`lib/algorithms/food-safety.ts`) enforces that its reported verdict can never be less severe than the floor, only equal or worse. A hallucinated "looks fine" can't talk its way under a real, reproducible safety floor. If Gemini is unavailable or its response doesn't parse, the deterministic verdict stands alone, `used_ai: false` — this project's established fallback discipline, applied to a safety-facing decision instead of a routing one.

**Wired into `POST /api/listings`:** the check runs before the donor is even resolved. `bad` writes an `audit_log` entry (`action: 'listing_safety_rejected'`) and returns `422` — no donor row, no listing row, no branch-matching AI call spent. `warning`/`good` proceed to the existing pipeline with the result attached to `decision_details.food_safety_check`, shown to staff via a `FoodSafetyBadge` on `/approvals` and `/item/[id]` — a `warning` verdict never blocks approval, it's visible exactly where a human decides. **The verdict is computed once, at submission** — `POST /api/approvals/[id]/approve` reconstructs `decision_details` from scratch for its own routing fields, so it explicitly carries `food_safety_check` forward from the stored decision rather than recomputing or dropping it.

No new migration or table — the corpus and scoring are pure functions plus one Gemini call, stored in the existing `decision_details` JSONB column.

### 7.8 Recipient profiles and the agent-computed pickup countdown (v2.3)

A claim is no longer fully anonymous, and a reservation no longer holds forever. Two changes, both scoped deliberately narrow:

**Lightweight recipient profiles — not authentication.** `recipient_profiles` (`009_recipient_profiles.sql`) is a name and an optional phone number, nothing else: no password, no email verification, nothing to log in with. `POST /api/profiles` creates one; the client persists the returned id in `localStorage` and reuses it for every future claim, replacing the old bare random `anonymous_id` (which still exists on the `claims` row for backward compatibility, just no longer the primary identity). Browsing stays fully anonymous — the profile modal only appears the first time a recipient actually tries to claim something, never on page load.

**One active reservation per profile.** `POST /api/claims` checks for an existing `claims` row with the same `profile_id` and `status = 'claimed'` before allowing a new one — a recipient sitting on an unclaimed reservation can't hold a second one hostage too. This only blocks *that recipient*; the item itself stays available to everyone else, and the client keeps it in the visible list rather than hiding it.

**The pickup countdown is always agent-computed, never a fixed constant.** `computePickupWindow()` (`lib/agents/pickup-window-agent.ts`) runs on every claim: a deterministic floor picks a base window from the same urgency tiers `describeShelfLife` already uses (critical <6h → 30min, urgent <24h → 90min, monitor <72h → 3h, stable ≥72h → 6h), clamped to never exceed half the item's actual remaining shelf life and never below 10 minutes. Gemini receives that floor plus the item's real remaining hours and, if one is cached, the donation's own supply chain plan (§8.7) — its total window and contingency trigger are extra context for how tight this donation's timeline already is — and may propose a different window, but the same clamp applies to its answer too, so it can tighten or loosen within a bounded, always-sane range. If Gemini is unavailable, the deterministic floor stands alone, `used_ai: false`.

**The deadline has teeth.** `GET /api/inventory` sweeps for expired countdowns before its existing escalation/expiry sweeps (same no-cron, sweep-on-read pattern, deliberately ordered first): any `claims` row still `'claimed'` past its `pickup_deadline_at` flips to `'no_show'`, and its `inventory_items` row releases back to `'in_stock'` — freeing both the item for someone else and the recipient's one-active-claim slot, in the same write. `/item/[id]`-equivalent visibility for this: `FoodCard` on `/recipient` shows a live, second-ticking countdown once claimed; `/storage`'s reserved-item row shows the same deadline to staff, recomputed each 15s poll rather than ticking live, since staff don't need sub-minute precision.

**Response integrity.** `POST /api/claims` only reports `pickup_deadline_at`/`pickup_window_minutes` in its response if the insert actually landed with those columns — caught live during testing: the first version computed the deadline unconditionally and always echoed it back, even on the graceful-degradation fallback insert (migration 009 not yet applied) that silently drops those columns. That would have shown recipients a countdown enforced by nothing, since nothing sweeps a deadline that was never actually stored.

---

## 8. AI Agent Architecture

Bitewise's AI layer is **genuinely agentic** — real Gemini function-calling tool use and a real autonomous decision step, not a script narrated with agent-sounding names. This section is written to stand up to direct scrutiny (e.g. hackathon judging on "is this a real AI agent").

### 8.1 Design principle

The deterministic formula (Section 7) is never bypassed — it's the ground truth every tool call is grounded in, and it's the guaranteed fallback at every failure point. The AI layer's job is **judgment on top of the numbers**, not the arithmetic itself. This means a lazy, wrong, or unavailable model can degrade the *quality of the rationale*, but can never produce a mathematically wrong score or block a live donation.

### 8.2 Pipeline stages (`lib/agents/run-pipeline.ts` → `runMatchingAgents()`)

**Stage 0 — Eligibility filter.** Branches at capacity are dropped immediately (Section 7.1). If zero branches are eligible, the pipeline short-circuits with `chosenBranchId: null` and no AI calls are made.

**Stage 0.5 — Deterministic shortlist.** Before spending any AI quota, all eligible branches are scored by the free, instant deterministic formula and ranked. Only the **top 3** (`SHORTLIST_SIZE`) proceed to real agents. This exists specifically to respect Gemini's free-tier rate limit (15 requests/minute per model) — see 8.8. Branches ranked below the top 3 are recorded under "Excluded from consideration" with an explicit, honest reason (not silently dropped).

**Stage 1 — Branch Coordination Agents** (`lib/agents/branch-agent.ts` → `runBranchAgent()`, one per shortlisted branch, run in parallel via `Promise.all`).

Each is a real Gemini (`gemini-3.5-flash-lite`) call given:
- A prompt instructing it to call all three of its tools before answering, then write a 1–2 sentence assessment referencing the actual numbers returned.
- Three **real function-calling tools** (`lib/agents/tools.ts`, `CallableTool` interface from `@google/genai`), each closed over that specific branch + donation's context so the model cannot hallucinate coordinates or inventory data — it can only decide *when* to call them:
  - `get_proximity_score` — returns `{score, distance_km}`
  - `get_fairness_need_score` — returns `{score, current_load_kg, capacity_kg}`
  - `get_spoilage_risk_score` — returns `{score, same_type_expiring_soon}`
- `toolConfig.functionCallingConfig.mode = AUTO` (Automatic Function Calling) — the model decides which tools to call and when; every actual call is logged (`ToolCallRecord[]`).

The agent's final `total_score` is computed by the same weighted formula (Section 7.3) from whatever the tools actually returned — with a direct deterministic fallback for any single tool the model happened to skip — so an incomplete or lazy model run can only ever produce a weaker rationale, never a wrong ranking.

**Stage 2 — Network Coordinator Agent** (`lib/agents/coordinator-agent.ts` → `runCoordinatorAgent()`, one call, after all branch reports are in).

A second Gemini call receives every shortlisted branch's tool-verified scores *and* its own rationale text, and is asked to pick exactly one branch — with **structured output** (`responseSchema`, `chosen_branch_id` constrained to an enum of the actually-reported branch IDs). It is explicitly told it may agree with the top score *or* choose differently if the reports justify it (e.g. a near-tie where proximity or spoilage risk is the more pressing real-world concern). Verified live: it does make genuinely different choices from the raw top score when justified, not just restate the winner.

Any response naming an invalid branch ID, or any API failure, falls back to the highest raw-scored branch with an explicit "coordinator was unavailable" rationale — a bad or missing model call can never break the flow.

### 8.3 Deterministic fallback

Triggered by: no `GEMINI_API_KEY` configured, any branch agent error, any coordinator error, or an invalid coordinator response. Runs `scoreBranches()` directly — identical math to Section 7, zero LLM calls — and is flagged transparently via `used_ai_agents: false`, surfaced as a visible amber warning in the UI rather than silently degrading.

### 8.4 Where the pipeline runs

- **`POST /api/listings`** — submission-time suggestion. Always runs the full pipeline (shortlist → agents → coordinator, or fallback).
- **`POST /api/approvals/[id]/approve`** — approval-time re-verification. See 8.5 for why this is *not* an unconditional second full run.

### 8.5 Approval-time reuse (quota + latency optimization)

Naively re-running the full pipeline at approval time (to catch branch loads that shifted between submission and approval) doubles the AI cost of every donation for what is usually an identical answer. The approve route instead:

1. Recomputes the three raw sub-scores (proximity, fairness, spoilage) for the **specific branch already chosen** at submission time, using **current** branch load and inventory.
2. If all three match the stored decision's values for that branch (within a `0.0005` floating-point tolerance) **and** that branch is still eligible → reuses the stored `decision_details` verbatim, spending zero new API calls.
3. Otherwise → re-runs the full pipeline fresh.

**Design note preserved for future maintainers:** the first implementation of this check compared the stored decision against the *deterministic* top-ranked branch, which is wrong — the coordinator is deliberately allowed to deviate from the raw top score, so that comparison would force a full, wasteful re-run every single time the AI made an interesting (non-top-score) decision, which defeats the entire point of having a coordinator. The correct check is "did the inputs behind the *already-made* decision change," never "does the decision match a naive recomputation."

### 8.6 Tool-call traces and idempotency

Every tool invocation an agent makes is recorded (`ToolCallTrace`: the tool name plus the exact object it returned) and persisted onto that candidate inside `decision_details`. The UI renders this as a collapsible per-agent trail — e.g. `get_proximity_score() → {"score":0.0357,"distance_km":2.69}` — so a reader can confirm the agent went and *fetched* its numbers rather than being handed them in a prompt, and can reconcile every displayed score against the raw tool output. This is the app's strongest available evidence of genuine function-calling behaviour.

Each tool is a pure function of the branch + donation context, so a repeat call within a single decision can only return the same value. Gemini's automatic function calling sometimes re-runs the whole tool set for a second round before answering, which produced six calls where three carried information. Tools are therefore **memoised per decision**: a repeat resolves from cache, costs nothing, and appends no duplicate trace entry — leaving one honest record per distinct tool.

### 8.7 Supply Chain Planner Agent

The routing agents answer *which branch*. The Supply Chain Planner Agent answers **what happens next** — it plans the donation's whole remaining journey, from the donor's doorstep to somebody eating it, and names the fallback recipient if the public never claims it.

**Runs on demand**, not automatically: staff click "Plan the supply chain" on a pending approval or an entry in the decision log. This keeps it off the critical path of every donation and out of the per-minute quota budget (Section 8.8). The finished plan is cached into `decision_details.supply_chain_plan`, so re-opening a decision costs nothing.

**Grounded inputs** (all real, none invented): the chosen branch's actual `has_cold_storage` / `has_cooking` flags and region, the real Haversine distance from the routing decision, the food-safety reference for this food type (`lib/knowledge/food-safety.ts`), the declared storage type, real hours until expiry, a live query for competing near-expiry stock of the same type at that branch, the real `ESCALATION_THRESHOLD_HOURS`, and the real partner-beneficiary list for the branch's region (`lib/data/beneficiaries.ts`).

**Two constraint tools** (real function calling, verified to work alongside structured output in a single call, so constraint-awareness costs no extra request against the rate limit):
- `check_fleet_availability` — how many suitable vehicles are free right now, the best option, and whether it must be borrowed from another branch and repositioned first.
- `check_storage_capacity` — used/total kilograms in the destination zone, occupancy, rack state, whether the incoming load fits, and whether the branch supports that zone at all.

Both read one consistent snapshot gathered before the call, so a tool response is always truthful — the agent decides *whether* a constraint matters to its plan, not what the constraint is. Memoised per plan for the same reason as the branch agents' tools. The calls it made are persisted and rendered under "Constraints checked".

**Output** is a `SupplyChainPlan`: an ordered set of stages (`pickup → transport → storage → listing → contingency → delivery`), each with a location, timing anchored to the real spoilage window, and an optional risk note; plus a contingency block naming one partner beneficiary with the reason it was chosen.

**Two guardrails:**
- The named beneficiary is **validated against the real partner list for that region** — a hallucinated organisation is rejected and the deterministic pick substituted, so the plan can never dispatch food to somewhere that doesn't exist.
- `buildDeterministicPlan()` produces the same structure with no AI at all, used when there's no API key or the call fails. Like the routing pipeline, the feature degrades rather than breaking, and the UI labels which produced the plan.

**Streaming (`GET /api/agents/plan`, SSE).** Each `step` event is emitted at the moment that work genuinely finishes — the record read, the branch confirmation, the food-safety lookup, the competing-stock query, the partner shortlist — then the model call runs and the plan arrives. Nothing is a timed animation standing in for computation: the observable pause sits exactly where the real thinking is (the Gemini call), and fast steps report instantly.

### 8.8 Reliability: Gemini free-tier rate limit

**Discovered live, not hypothetically:** Gemini's free tier caps `generateContent` at **15 requests/minute per model**. The unoptimized design (agent per eligible branch + coordinator, unconditionally re-run at approval) cost up to 12 calls per single donation submit-then-approve cycle — enough to exhaust the quota within one normal user flow, causing exactly the least-desirable failure mode: the fallback firing on the *permanently stored* Agent Decision Log entry, the one artifact most likely to be scrutinized. Sections 8.2 (shortlist to top 3) and 8.5 (approval-time reuse) are the direct fixes, bringing steady-state usage to ~4 calls per donation (submission only; approval reuses for free in the common case) — verified live end-to-end with the real API key, with zero rate-limit errors across repeated submit → approve → audit-log cycles after the fix.

---

## 9. Data Model

Supabase (Postgres). All writes go through Next.js API routes using the service-role key (bypasses Row Level Security); the only anonymous/client-side reads are public `SELECT` policies (9.8) and one Realtime subscription.

### 9.1 `donors`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default `uuid_generate_v4()` |
| `name` | TEXT | NOT NULL |
| `type` | TEXT | NOT NULL, CHECK IN (`supermarket`, `hotel`, `restaurant`, `factory`, `other`) |
| `lat`, `lng` | DOUBLE PRECISION | NOT NULL |
| `address` | TEXT | nullable |
| `reliability_score` | REAL | default 0.5, CHECK 0–1 |
| `total_kg_donated` | INTEGER | default 0 |
| `status` | TEXT | default `verified`, CHECK IN (`pending`, `verified`, `suspended`) |
| `created_at` | TIMESTAMPTZ | default `NOW()` |

### 9.2 `branches`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `organization_name` | TEXT | default `'Willing Hearts'` |
| `name` | TEXT | NOT NULL |
| `area` | TEXT | nullable |
| `lat`, `lng` | DOUBLE PRECISION | NOT NULL |
| `capacity_kg` | INTEGER | NOT NULL |
| `current_load_kg` | INTEGER | default 0 |
| `has_cold_storage` | BOOLEAN | default false |
| `has_cooking` | BOOLEAN | default false |
| `color` | TEXT | default `#0A84FF` (UI accent per branch) |
| `created_at` | TIMESTAMPTZ | default `NOW()` |

**Seed data (5 branches):**

| Branch | Area | Capacity (kg) | Cold storage | Cooking |
|---|---|---|---|---|
| Woodlands | North | 500 | ✔ | ✘ |
| Toa Payoh | Central | 400 | ✔ | ✔ |
| Bukit Merah | South | 600 | ✔ | ✔ |
| Yishun | North | 350 | ✘ | ✘ |
| Tampines | East | 450 | ✔ | ✘ |

### 9.3 `food_listings`

The central workflow table — `status = 'pending'` means nothing has been committed to any branch yet.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `donor_id` | UUID | FK → `donors.id` |
| `matched_branch_id` | UUID | FK → `branches.id`, nullable |
| `item_name` | TEXT | NOT NULL |
| `food_type` | TEXT | NOT NULL, CHECK IN (`bread`, `cooked`, `produce`, `canned`, `dairy`, `beverage`, `grain`, `other`) |
| `quantity_kg` | REAL | NOT NULL, CHECK > 0 |
| `storage_type` | TEXT | NOT NULL, CHECK IN (`ambient`, `cold`, `frozen`) |
| `expiry_at` | TIMESTAMPTZ | NOT NULL |
| `status` | TEXT | default `pending`, CHECK IN (`pending`, `matched`, `in_transit`, `delivered`, `expired`, `cancelled`) |
| `matching_score` | REAL | nullable |
| `spoilage_risk_score` | REAL | nullable |
| `matched_at` | TIMESTAMPTZ | nullable |
| `delivered_at` | TIMESTAMPTZ | nullable |
| `reviewed_at` | TIMESTAMPTZ | nullable *(added: `002_approval_workflow.sql`)* |
| `agreed_to_regulations` | BOOLEAN | NOT NULL default false *(added: `002`)* |
| `decision_details` | JSONB | full agent/algorithm transcript at decision time, plus the cached `supply_chain_plan` once one has been generated *(added: `002`)* |
| `created_at` | TIMESTAMPTZ | default `NOW()` |

### 9.4 `inventory_items`

Committed stock at a branch, created only on approval.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `branch_id` | UUID | FK → `branches.id` |
| `item_name` | TEXT | NOT NULL |
| `food_type` | TEXT | NOT NULL |
| `quantity` | REAL | NOT NULL |
| `unit` | TEXT | default `kg` |
| `storage_type` | TEXT | NOT NULL, CHECK IN (`ambient`, `cold`, `frozen`) |
| `received_at` | TIMESTAMPTZ | default `NOW()` |
| `expiry_at` | TIMESTAMPTZ | NOT NULL |
| `listing_id` | UUID | FK → `food_listings.id`, `ON DELETE SET NULL`, nullable *(added: `007`)* — provenance, and the join that makes delivery progress derivable |
| `status` | TEXT | default `in_stock`, CHECK IN (`in_stock`, `reserved`, `distributed`, `expired`, `escalated`) — `'escalated'` added in `003_escalation.sql` |
| `created_at` | TIMESTAMPTZ | default `NOW()` |

### 9.5 `claims`

Public claims against inventory. `anonymous_id` predates profiles and is kept only for backward compatibility — `profile_id` is the identity a claim actually resolves to as of v2.3.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `anonymous_id` | UUID | NOT NULL, default `uuid_generate_v4()` — legacy, no longer the primary identity |
| `profile_id` | UUID | FK → `recipient_profiles.id`, nullable (`009_recipient_profiles.sql`) — the actual claiming identity |
| `inventory_item_id` | UUID | FK → `inventory_items.id` |
| `status` | TEXT | default `claimed`, CHECK IN (`claimed`, `picked_up`, `no_show`) — `no_show` is reused for both a confirmed no-show and an expired pickup countdown |
| `claimed_at` | TIMESTAMPTZ | default `NOW()` |
| `picked_up_at` | TIMESTAMPTZ | nullable |
| `pickup_deadline_at` | TIMESTAMPTZ | nullable (`009_recipient_profiles.sql`) — agent-computed at claim time (§7.8); past this with `status='claimed'`, the next `/api/inventory` read releases it |

### 9.5a `recipient_profiles` (`009_recipient_profiles.sql`)

A recipient's lightweight, non-authenticated identity — a name and an optional phone number, nothing else that would make this real authentication.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `phone` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | default `NOW()` |

### 9.6 `fairness_snapshots`

Time series of network-wide fairness, one row per approval event.

| Column | Type |
|---|---|
| `id` | UUID PK |
| `jain_index` | REAL NOT NULL |
| `branch_ratios` | JSONB NOT NULL — `{branch_id: load/capacity}` |
| `total_food_rescued_kg` | REAL default 0 |
| `created_at` | TIMESTAMPTZ default `NOW()` |

### 9.7 `audit_log`

Append-only event log. Populated actions: `listing_submitted`, `match_approved`, `match_rejected`.

| Column | Type |
|---|---|
| `id` | UUID PK |
| `actor_type` | TEXT NOT NULL — `system`, `public_donor`, or `ngo_staff` |
| `action` | TEXT NOT NULL |
| `entity_type` | TEXT — e.g. `food_listing` |
| `entity_id` | TEXT |
| `details` | JSONB default `{}` — for match events, the full `decision_details` transcript |
| `created_at` | TIMESTAMPTZ default `NOW()` |

### 9.8 `vehicles` and `fleet_runs` (`006_fleet.sql`)

Two tables rather than one, deliberately: a vehicle's *current* state and the *history* of what it has done are different things, and cramming both into one row means a completed run overwrites the previous one — leaving no log for the logistics page to show.

**`vehicles`** — what a branch owns; changes rarely.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `branch_id` | UUID | FK → `branches.id` — the vehicle's home branch |
| `label` | TEXT | UNIQUE, e.g. `WH-N1` |
| `type` | TEXT | CHECK IN (`refrigerated`, `truck`, `van`, `bike`) |
| `driver_name` | TEXT | NOT NULL |
| `capacity_kg` | INTEGER | CHECK > 0 |
| `is_offline` | BOOLEAN | default false — off the road, kept separate from run status so taking a van offline never destroys run history |

**`fleet_runs`** — one row per collection job. This *is* the log.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `vehicle_id` | UUID | FK → `vehicles.id` |
| `listing_id` | UUID | FK → `food_listings.id`, `ON DELETE SET NULL` |
| `serving_branch_id` | UUID | The branch this pickup serves. Differs from the vehicle's home branch when borrowed — this is how cross-branch lending is represented |
| `status` | TEXT | CHECK IN (`assigned`, `en_route`, `picked_up`, `completed`, `cancelled`) |
| `quantity_kg` | REAL | |
| `assigned_at` / `en_route_at` / `picked_up_at` / `completed_at` | TIMESTAMPTZ | Stamped as the run advances |

**A vehicle's live status is derived, never stored:** `is_offline` → `offline`; an open run (`assigned`/`en_route`/`picked_up`) → that run's status; otherwise `idle`. One source of truth, so the board can't disagree with the runs behind it.

**Partial unique index** `idx_fleet_runs_one_open_per_vehicle` allows at most one open run per vehicle. This is what actually prevents the same van being dispatched twice — the database enforces it rather than the app checking first, the same approach used for approvals and claims.

Seeded with **12 vehicles** across the 5 branches. Fleet composition mirrors facilities: branches with cold storage get a refrigerated vehicle, the largest gets the truck, bikes cover small urgent runs. Yishun has no cold storage and therefore no refrigerated vehicle — which is exactly the situation that forces a cross-branch borrow for a chilled pickup.

### 9.9 `beneficiary_allocations` (`008_beneficiary_allocations.sql`)

One row per donation routed to a partner beneficiary via demand-quota allocation (Section 7.6). `PARTNER_BENEFICIARIES` itself stays a static file (`lib/data/beneficiaries.ts`), not a table — three other real consumers (`/api/dispatch`, `/api/agents/plan`, the Supply Chain Planner Agent) already depend on its exact shape, and this table only needs to record *fulfilment against* that static roster, not replace it.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `beneficiary_key` | TEXT NOT NULL | Stable slug, e.g. `marsiling-fsc` — join key back to `PARTNER_BENEFICIARIES`, independent of display name |
| `beneficiary_name` | TEXT NOT NULL | Denormalized for audit/display without a lookup |
| `inventory_item_id` | UUID | FK → `inventory_items.id`, `ON DELETE SET NULL` |
| `quantity_kg` | NUMERIC NOT NULL | |
| `allocated_at` | TIMESTAMPTZ | default `NOW()` |

Fulfilment for "today" is computed by summing `quantity_kg` per `beneficiary_key` where `allocated_at >= UTC midnight`.

### 9.10 Postgres functions (`004_atomic_increments.sql`)

Atomic single-statement increments, called via `supabase.rpc(...)`, replacing unsafe read-then-write JS updates:

```sql
increment_branch_load(p_branch_id UUID, p_amount NUMERIC) → INTEGER
increment_donor_total(p_donor_id UUID, p_amount NUMERIC) → INTEGER
```

### 9.11 Indexes

`food_listings(status)`, `inventory_items(branch_id)`, `inventory_items(expiry_at)`, `inventory_items(status)`, `claims(inventory_item_id)`, `claims(profile_id)`, `claims(pickup_deadline_at)`, `beneficiary_allocations(beneficiary_key)`, `beneficiary_allocations(allocated_at)`.

### 9.12 Realtime & Row Level Security

- **Realtime publication** enabled on `food_listings`, `branches`, `inventory_items`, `fairness_snapshots`. In practice only `branches` `UPDATE` is subscribed to client-side (the `/orchestrator` fairness gauge).
- **RLS enabled on every table.** Public `SELECT` policies exist on `donors`, `branches`, `food_listings`, `inventory_items`, `fairness_snapshots`, `beneficiary_allocations`, `recipient_profiles`. **No policies** exist for `claims` or `audit_log` for the anon/authenticated roles — with RLS on and no policy, Postgres denies all client-side access by default, keeping claim identifiers and the audit trail service-role-only. All writes happen through API routes using the service-role key, which bypasses RLS entirely — RLS here is a defense-in-depth boundary for accidental direct client reads, not the primary access-control mechanism (there isn't one — see [Known Limitations](#15-known-limitations--risks)).

---

## 10. API Specification

All routes are Next.js Route Handlers under `app/api/`. No authentication on any route (see Section 15). All mutating routes are `POST`; all use `zod` for request validation where the body is non-trivial.

### `GET /api/fairness`
Returns network-wide state for the dashboard.
```ts
FairnessResponse {
  jain_index: number
  branches: { id, name, area, color, lat, lng, ratio, current_load_kg, capacity_kg }[]
  total_rescued_kg: number
  meals_equivalent: number
  co2_avoided_kg: number
  active_deliveries: number
}
```
`total_rescued_kg` / `active_deliveries` only count listings with status `matched`/`in_transit`/`delivered` — `pending` listings are excluded (nothing is "rescued" until approved).

### `GET /api/donors`
Returns all donors, ordered by `total_kg_donated` descending.

### `GET /api/inventory`
Three lazy side effects, in this order, before reading: (1) any `claims` row still `'claimed'` past its `pickup_deadline_at` releases (§7.8) — `claims.status → 'no_show'`, `inventory_items.status → 'in_stock'`; (2) any `in_stock` item within 3 hours of `expiry_at` flips to `escalated`; (3) anything genuinely past `expiry_at` flips to `expired`. Returns all `inventory_items` joined with `branches (id, name, area, color, organization_name)`, ordered by `expiry_at` ascending, each with `pickup_deadline_at` when actively reserved.

### `POST /api/profiles`
```ts
Request: { name: string (1-100 chars), phone?: string (≤30 chars) }
Response: CreateProfileResponse { success, message?, profile?: { id, name, phone, created_at } }
```
Creates a `recipient_profiles` row — the lightweight, non-authenticated identity §7.8 requires before a claim. If this fails (most likely migration 009 not applied), the client falls back to a locally-generated identity rather than blocking the claim — see §7.8.

### `POST /api/claims`
```ts
Request: { inventory_item_id: uuid, profile_id: uuid }
Response: ClaimResponse {
  success, message?, reason?: 'active_claim_exists',
  pickup_deadline_at?, pickup_window_minutes?, pickup_window_rationale?
}
```
First checks for an existing `claims` row with the same `profile_id` and `status='claimed'` — if one exists, `409 { reason:'active_claim_exists' }` (the item stays available to everyone else). Otherwise atomically guarded exactly as before: `UPDATE inventory_items SET status='reserved' WHERE id=? AND status='in_stock'`; 0 rows updated → `409 { message:"already claimed by someone else" }`. On success, computes an agent pickup window (§7.8) and inserts a `claims` row with `profile_id` + `pickup_deadline_at` — falling back to an insert without those columns if migration 009 isn't applied, in which case the response omits `pickup_deadline_at`/`pickup_window_minutes` entirely rather than promising a countdown nothing will ever enforce.

### `POST /api/claims/[id]/pickup`
Staff confirm a reserved item was actually collected — the other half of the claim lifecycle that used to be missing entirely. `[id]` is the `inventory_item_id`. Same compare-and-swap guard as everywhere else: `UPDATE inventory_items SET status='distributed' WHERE id=? AND status='reserved'`; 0 rows updated → `409`. Best-effort updates the matching `claims` row to `status='picked_up'` + `picked_up_at`.

### `POST /api/listings`
Public + internal donation submission (also used by the Simulate button).
```ts
Request:
  donor_id?: uuid                                    // returning donor, OR:
  donor_name?, donor_type?, address?, area?           // new donor (all 4 required together)
  item_name: string
  food_type: 'bread'|'cooked'|'produce'|'canned'|'dairy'|'beverage'|'grain'|'other'
  quantity_kg: number (> 0)
  storage_type: 'ambient'|'cold'|'frozen' (default 'ambient')
  expiry_hours: number (> 0, ≤ 8760)
  agreed_to_regulations: true                          // literal, must be true

Response: SubmitListingResponse {
  success, message?, listing_id?,
  suggested_branch?, suggested_branch_id?, suggested_branch_color?,
  suggested_branch_lat?, suggested_branch_lng?,
  score?, distance_km?, spoilage_risk_score?,
  food_safety_check?: FoodSafetyCheckResult
}
```
**Runs the standardized food-safety check first (§7.7), before anything else is touched.** A `bad` verdict returns `422` with `success:false` and `food_safety_check` set — no donor row, no listing row, nothing else in this sequence runs. Otherwise: resolves or creates the donor (new public donors start `status:'pending'`), runs the full matching/agent pipeline (Section 8), inserts a `pending` `food_listings` row with the complete `decision_details` (including `food_safety_check`), and logs `listing_submitted` to `audit_log`. **Never commits anything to a branch** — the response is advisory only.

### `GET /api/listings/[id]`
Powers `/item/[id]` (§11.2). Same stage derivation as `/api/pipeline` — via the shared `computePipelineEntry()` helper in `lib/pipeline.ts` — just for one listing instead of the 12 most recent, so the dashboard feed and the detail page can never disagree about where a donation actually is. `404` if the id doesn't exist.

### `GET /api/approvals`
Returns all `pending` `food_listings`, joined with donor summary, ordered oldest-first — the NGO staff queue.

### `POST /api/approvals/[id]/approve`
The only route that actually commits a donation. Sequence:
1. Fetch listing + donor + all branches + current in-stock inventory.
2. Decide whether to reuse the stored decision or re-run the AI pipeline (Section 8.5).
3. Run demand-quota allocation (Section 7.6) against the matched branch's area partners; record the result (or lack of one) into `decision_details.beneficiary_allocation`.
4. **Claim the listing first**, atomically: `UPDATE food_listings SET status='matched', ... WHERE id=? AND status='pending'` — 0 rows updated → `409` (already reviewed). This is what actually resolves a race between two concurrent approval attempts.
5. Atomically increment the matched branch's `current_load_kg` via `increment_branch_load` RPC. **If this fails**, the claim is rolled back (`status` reset to `pending`) rather than leaving an orphaned `matched`-with-no-inventory listing.
6. Insert the `inventory_items` row — `status = 'escalated'` if step 3 found a partner, `'in_stock'` otherwise. If a partner was found, also insert a `beneficiary_allocations` row.
7. Atomically increment the donor's `total_kg_donated` via `increment_donor_total` RPC; flip donor `status` from `pending` to `verified` if this was their first approval.
8. Re-fetch fresh branch state, recompute Jain's Fairness Index, insert a `fairness_snapshots` row.
9. Insert `match_approved` to `audit_log` with the full `decision_details`.
```ts
Response: ApprovalActionResponse { success, message?, matched_branch?, jain_index? }
```

### `POST /api/approvals/[id]/reject`
Atomically guarded `UPDATE food_listings SET status='cancelled' WHERE id=? AND status='pending'`; logs `match_rejected`. No branch/donor/inventory side effects.

### `GET /api/audit`
Last 30 `match_approved` entries, filtered to only those with a `candidates` array present in `details` (older pre-agent-log entries are silently skipped, not error'd) — feeds the `/agents` Decision Log.

### `GET /api/agents/plan?listing_id=<uuid>` (Server-Sent Events)
Streams the Supply Chain Planner Agent's work, then the finished plan.

| Event | Payload | Meaning |
|---|---|---|
| `step` | `{id, label, status: 'running'\|'done', note?}` | A unit of work finished (or started, for the model call). Same `id` re-sent to flip `running` → `done`. |
| `cached` | `{plan}` | A plan already existed; returned immediately, no Gemini call. |
| `plan` | `{plan}` | Freshly generated `SupplyChainPlan`. |
| `error` | `{message}` | Unrecoverable — e.g. listing not found, or no branch assigned yet. |
| `done` | `{}` | Stream complete. |

Caches the result into `food_listings.decision_details.supply_chain_plan` (no schema change required). Returns `400` if `listing_id` is absent.

### `GET /api/fleet`
Returns every vehicle with derived live status, its open run (including whether it's a cross-branch loan), per-branch coverage counts, and recently closed runs as a log. Answers `200` with `error: 'fleet_unavailable'` (not a 5xx) when migration 006 hasn't been applied, since that's a known setup state the page renders a message for.

### `POST /api/fleet/[id]/advance`
```ts
Request: { action?: 'advance' | 'cancel' }   // default 'advance'
```
Moves one run to its next state (`assigned → en_route → picked_up → completed`). The write is guarded on the status just read, so two staff advancing the same run concurrently produce one success and one `409`.

### `GET /api/storage`
Per-branch zone breakdown: rack occupancy, modelled temperature and health, plus each item's shelf life and listed/reserved/escalated state. Fully derived from `inventory_items` + `branches` — no zone or sensor tables.

### `GET /api/dispatch`
Proposed partner delivery runs: escalated **and still-edible** stock grouped by branch, per-item partner assignment, shortest multi-stop route, and a suggested vehicle. Read-only — it proposes runs, staff commit them.

### `GET /api/beneficiaries`
The demand-quota network view (Section 7.6), powering `/dispatch`'s "Beneficiary Network" panel.
```ts
BeneficiaryResponse {
  beneficiaries: { key, name, type, area, daily_quota_kg, fulfilled_today_kg, quota_pct, serves }[]
  fairness_index: number   // Jain's Fairness Index across every partner's quota fulfilment
  tracking_available: boolean  // false if 008_beneficiary_allocations.sql hasn't been run yet
}
```
Sorted by `quota_pct` descending. `tracking_available: false` means every `fulfilled_today_kg` reads as 0 — the migration is missing, not that no partner has been fed.

### `GET /api/pipeline`
Powers the Network Overview dashboard's `DonationFlowPanel`. Returns the 12 most recent `food_listings` (any status), each with a server-derived `stage` (`submitted | approved | collecting | in_transit | listed | claimed | closed`) computed by cross-referencing `fleet_runs` and `inventory_items` for that listing — necessary because `food_listings.status` itself never advances past `'matched'`. Each entry carries the full `decision_details` (so a still-pending row can render straight into `ApprovalCard`) plus the assigned vehicle/driver if one exists.

### `POST /api/food-safety/check`
The standardized check (§7.7), exposed standalone so `/donate` can show an instant verdict — same corpus, same scoring `POST /api/listings` runs server-side as the actual gate, so the two surfaces can never disagree about a given item.
```ts
Request: { item_name, food_type, storage_type, quantity_kg (≤10000), expiry_hours (≤8760), note? (≤500 chars) }
Response: FoodSafetyCheckResponse {
  success: boolean
  message?: string                                      // when success:false (internal failure)
  result?: FoodSafetyCheckResult {
    verdict: 'good' | 'warning' | 'bad'
    score: number                                        // 0-100, informational
    category_key, category_label: string
    perishable, requires_cold_chain: boolean
    safe_temp_note: string
    ratio: number                                         // declared shelf life ÷ safe max for declared storage
    reasoning: string
    used_ai: boolean
    recommended_storage_type?, recommended_expiry_hours?: … | null
  }
}
```
Always responds `200` even on internal failure — degrades to `success:false` with a human-readable message; the deterministic floor inside `runFoodSafetyCheck()` never throws on its own, only the optional Gemini call can fail, and that failure is caught internally.

---

## 11. Page-by-Page Specification

| Route | Shell | Purpose |
|---|---|---|
| `/` | — | Redirects to `/orchestrator`. |
| `/orchestrator` | NGO (`Sidebar`) | Network Overview dashboard: 4 stat cards, Leaflet map (donors + branches + animated route on simulate), Jain fairness gauge, per-branch saturation bars, Simulate button, live realtime refresh on branch load changes. Below that, a **Command Center** section makes the page an operable control surface rather than a read-only summary. Its centerpiece is `DonationFlowPanel` — the 12 most recent donations as one clickable feed, each row showing its *real* current stage (submitted → approved → collecting → in transit → listed → claimed, derived server-side by `/api/pipeline` since `food_listings.status` alone stops at `'matched'` forever) via a compact stepper. Clicking a row navigates to that donation's own page at `/item/[id]` (§11.2) — nothing expands in place. Below the feed, `FleetSummaryPanel` and `StorageSummaryPanel` give network-wide fleet and storage overviews not tied to any one donation — each panel links to its dedicated page for the full picture. |
| `/item/[id]` | NGO (`Sidebar`) | One donation's whole story on one page — see §11.2. |
| `/approvals` | NGO | Pending Approvals queue — one card per pending listing with full `CandidateBreakdown` transcript and Approve/Reject buttons. Polls every 6s. |
| `/agents` | NGO | Agent Decision Log — one row per approved match; each row links to that donation's `/item/[id]` page (the same `CandidateBreakdown` transcript, permanently preserved) rather than expanding in place. Polls every 6s. |
| `/donors` | NGO | Donor grid (ranked by total kg donated) + click-through profile modal with meals-equivalent/CO₂ stats. |
| `/storage` | NGO | Inventory grouped by branch, sorted by urgency, with color-coded `ExpiryBadge`s (Stable/Monitor/Urgent/Critical/Expired). Any item with a traceable `listing_id` links to its `/item/[id]` page. A reserved item shows its pickup deadline (§7.8) alongside the "Mark picked up" action, recomputed each poll. |
| `/donate` | Public (`PublicShell`) | Donation intake form + automatic, instant food-safety verification (§7.7) + mandatory guidelines checkbox. A `bad` verdict blocks submission with an explanation; success state shows the suggested branch, "awaiting NGO approval," and the donor's own safety verdict. |
| `/recipient` | Public | Browse of all `in_stock` inventory network-wide stays fully anonymous. Claiming asks for a name once (§7.8, not authentication), then shows a live agent-computed pickup countdown on the claimed card. |

**Shared nav:** the NGO `Sidebar` links to all 5 NGO pages plus a "Public View" escape hatch to `/recipient`; the public `PublicShell` has a 2-tab switcher (Browse / Donate) plus an "NGO View" escape hatch to `/orchestrator`. Either audience can freely cross over — there is no access boundary (see Section 15).

### 11.1 Shared UI behaviour

All five NGO pages render through one `AppShell` (`components/layout/AppShell.tsx`), so the following are defined once rather than per page:

- **Responsive chrome** — persistent 240px sidebar at ≥1024px; below that, a sticky top bar with a hamburger opens the sidebar as an off-canvas drawer over a scrim. The drawer closes on navigation, on `Escape`, on scrim tap, and automatically if the viewport grows past the breakpoint; body scroll is locked while it's open.
- **Command palette** — `⌘K` / `Ctrl+K` (or the sidebar's "Jump to…" button) opens a filterable palette covering all 7 routes, with arrow-key navigation, `Enter` to open, and `Escape` to dismiss.
- **Toasts** — a single app-wide `ToastProvider` (`components/ui/Toast.tsx`) surfaces action outcomes: approvals report the chosen branch and the resulting fairness index, rejections and claim conflicts report what happened, network failures say so. Replaces the previous inline-only error text.
- **Loading and empty states** — every list renders shape-matched skeletons while loading (so layout doesn't jump) and a designed `EmptyState` with an explanation of how to populate it, instead of bare "No items" text.
- **Reduced motion** — all animation is disabled under `prefers-reduced-motion: reduce`.

### 11.2 Item Detail page (`/item/[id]`)

Every donation's full story lives at one URL instead of behind a click-to-expand accordion. Three surfaces link into it — `DonationFlowPanel` (dashboard feed), `/agents` (decision log), `/storage` (any item with a traceable `listing_id`) — and all three fetch the same `GET /api/listings/[id]` (§10), so the page can never show something different from what those surfaces implied.

The page renders one of three bodies depending on the fetched `stage`:
- **`submitted`** — the exact same `ApprovalCard` used on `/approvals`: full reasoning breakdown, cached or on-demand supply chain plan, Approve/Reject.
- **`closed`** (rejected or expired) — a one-line explanation, no further action possible.
- **Anything else** (approved through claimed) — `JourneyCard` (donor→branch route, assigned vehicle, an inline "advance run" action), a `BeneficiaryAllocationCard` when `decision_details.beneficiary_allocation` is present (which partner, their quota fill, need/proximity scores — Section 7.6), plus the full `SupplyChainPlan` — the same horizontal, click-a-node timeline described in §8.7, always visible immediately (no button, no accordion) since the plan is generated once and cached on the listing.

`JourneyCard`, `BeneficiaryAllocationCard`, and the stage stepper are shared from `components/dashboard/DonationJourney.tsx` so the dashboard feed's compact row and this full page can never visually disagree about a donation's stage.

---

## 12. Non-Functional Requirements

### 12.1 Reliability
- The matching/agent pipeline must **never** block a live donation: every AI call has a deterministic fallback (Section 8.3), and every fallback is visibly flagged rather than silently swapped in.
- Concurrent-write safety: both the approval flow and the public claim flow use atomic guarded `UPDATE ... WHERE status = 'pending'/'in_stock'` writes (not read-then-check-then-write) so two simultaneous requests for the same resource can't both "win" — verified live by firing concurrent requests at the same listing/item.
- Branch load and donor totals are updated via atomic single-statement Postgres functions (`increment_branch_load`, `increment_donor_total`), not JS read-modify-write, to prevent lost updates under concurrent approvals.
- A failed atomic increment mid-approval rolls the listing back to `pending` rather than leaving it stuck in an orphaned state.

### 12.2 Performance / cost
- AI agent calls are shortlisted to the top 3 candidate branches (not all eligible branches) specifically to stay under Gemini's free-tier 15 req/min quota.
- Approval-time re-verification reuses the submission-time decision whenever the relevant inputs haven't changed, avoiding a redundant second full AI pass on the common path.

### 12.3 Transparency & auditability
- Every matching decision — algorithmic or AI-assisted — is persisted in full (`decision_details` / `audit_log.details`), including every branch's individual scores and (when AI ran) its own rationale text and complete tool-call trace, not just the winning branch.
- Fallback-to-deterministic is always visibly flagged in the UI (`used_ai_agents: false`), never silently substituted — and the fallback message is *not* attributed to a coordinator agent that didn't run.
- Branches skipped by the shortlist are listed with the real reason they were skipped, distinct from branches genuinely at capacity.

### 12.4 Failure visibility
- Background/opportunistic writes must not swallow their errors. The near-expiry escalation sweep is the cautionary case: because its error was discarded, a rejected CHECK constraint silently disabled the whole feature while every request still returned `200`. Such operations now log an explicit, actionable message (naming the migration to run) while still allowing the request to succeed.
- Migration state is verifiable on demand via `npm run check:migrations` rather than being assumed.

### 12.5 Privacy
- Browsing collects zero personal data. Claiming (v2.3, §7.8) asks for a name and an optional phone number — the minimum needed for a branch to know who's collecting — stored client-side in `localStorage` and server-side in `recipient_profiles`; still no account, no password, nothing to log in with. Phone is optional; only a name is required.

### 12.6 Accessibility & responsiveness
- Every page must render with zero horizontal page overflow from 390px to 1440px wide; wide content (score tables, tool traces) scrolls inside its own container rather than the page body.
- Interactive controls carry accessible names (`aria-label` on icon-only buttons, `aria-expanded` on disclosures, `aria-modal`/`role="dialog"` on the palette, `aria-live` on the toast region).
- All motion respects `prefers-reduced-motion`.

### 12.7 Data integrity
- All enum-like fields (`donor.type`, `food_type`, `storage_type`, listing/inventory/claim `status`) are enforced with Postgres `CHECK` constraints, not just application-layer validation.

---

## 13. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) |
| Language | TypeScript 5, React 19.2 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (Postgres) — schema in `supabase/schema.sql`, incremental migrations in `supabase/migrations/` |
| Realtime | Supabase Realtime (Postgres logical replication) |
| Validation | Zod v4 |
| AI provider | Google Gemini via `@google/genai` SDK (`gemini-3.5-flash-lite`) |
| Maps | Leaflet + react-leaflet |
| Charts | Recharts |
| Animation | Framer Motion |
| Icons | lucide-react |
| Dates | date-fns |
| Lint/typecheck | ESLint 9 (`eslint-config-next`), `tsc --noEmit` |
| Unit tests | Vitest (`npm test`) — 105 tests covering Haversine, Jain's index, the full matching algorithm, fleet/storage operations, the food-safety retrieval/scoring engine, and live API integration (concurrency races, approval commits) |

---

## 14. Metrics & KPIs

| Metric | Where shown | Definition |
|---|---|---|
| Total Food Rescued (kg) | `/orchestrator` | Σ `quantity_kg` over listings with status `matched`/`in_transit`/`delivered` |
| Meals Equivalent | `/orchestrator`, donor profile | `round(total_rescued_kg × 2)` |
| CO₂ Avoided (kg) | `/orchestrator`, donor profile | `total_rescued_kg × 2.5` |
| Active Deliveries | `/orchestrator` | count of listings with status `matched` or `in_transit` |
| Jain's Fairness Index | `/orchestrator` gauge, `fairness_snapshots` history | Section 7.4; target close to 1.0 |
| Per-donor lifetime kg | `/donors` | `donors.total_kg_donated`, incremented atomically on each approval |
| Pending queue depth | Sidebar badge | live count of `pending` listings |

---

## 15. Known Limitations & Risks

Ranked by severity, as identified through direct code audit and live testing (not just design review):

1. **No authentication or authorization anywhere.** There's no login system — staff and public views are just different pages, not different privilege levels. Every mutating route (approve, reject, pickup confirmation, fleet advance, partner-delivery confirmation) is reachable by anyone with the URL, from the browser console or a raw script, without ever touching the UI. Acceptable for a demo/hackathon context; would need real auth (staff login, role separation from the public surface) before any real deployment. **This is the single largest gap.**
2. **AI provider dependency + cost ceiling.** The agent pipeline depends on Gemini's free-tier quota (15 req/min per model); Section 8.8 documents the mitigations shipped (shortlisting, approval-time reuse, idempotent tools). A per-IP rate limiter (`lib/rate-limit.ts`) now caps `/api/listings`, `/api/food-safety/check`, and `/api/claims` to stop a scripted burst from exhausting the shared quota, but sustained high-volume production use would still need a paid tier.
3. **All 9 migrations are applied** as of 2026-08-17 (`npm run check:migrations`) — run it again for current status, this list has gone stale before and will again. `010_recipient_profiles_privacy.sql` (fixing an overly-permissive RLS policy that let anyone read recipient name/phone via the anon key) is the newest and must be run manually in the Supabase SQL Editor; there is no DDL-execution path from the app itself.
4. **Migration drift is invisible by default.** There is no migration-tracking table; the app doesn't know or announce which migrations a given database has. `scripts/check-migrations.mjs` (`npm run check:migrations`) probes the live project for each migration's observable effect and reports what's missing — this is the mitigation, not a substitute for a real migration runner.
5. **Single-region, single-tenant assumptions.** Area→coordinate resolution is a hardcoded Singapore lookup (`lib/constants.ts`), and the whole model assumes one organization's branch network. Neither is a defect for the stated product, but both would need replacing for any other geography or a multi-charity deployment.

### Resolved since v2.2 (v2.3 — recipient profiles + agent-computed pickup countdown)

- ~~A claim was fully anonymous forever, and a reservation held indefinitely~~ → §7.8. Claiming now asks for a name (optional phone) once, via `POST /api/profiles` — not authentication, no password — persisted client-side and reused for every future claim. A profile can hold only one active (`'claimed'`-status) reservation at a time, checked before the item itself is touched. Every claim gets a pickup deadline computed fresh by an agent from the item's real remaining shelf life (and, when cached, its supply chain plan) rather than a fixed constant; miss it and `GET /api/inventory`'s lazy sweep releases the reservation automatically — same no-cron pattern as the existing escalation/expiry sweeps, deliberately ordered to run first.
- ~~Browsing conflated with claiming when reasoning about "anonymous"~~ → Made explicit throughout the docs and the UI copy: browsing `/recipient` stays fully anonymous, zero personal data, no account ever required just to look. Only claiming asks for anything, and what it asks for is not authentication.
- **Real bug caught live, not by review**: the first version of `POST /api/claims` computed the pickup deadline unconditionally and always echoed it back in the response — including on the graceful-degradation fallback insert path (migration 009 not yet applied), which silently drops the `pickup_deadline_at` column. Confirmed live: the claim succeeded, the response promised a deadline, but the actual `claims` row had no such column and nothing would ever have swept it. Fixed by tracking whether the insert actually landed with those columns and omitting them from the response otherwise — a countdown a recipient can see must be one the server can actually enforce.

### Resolved since v2.1 (v2.2 — standardized, blocking food-safety verification)

- ~~Food-safety checking was optional, manual, and covered only 8 loose categories~~ → The old Sorting Agent (`POST /api/sorting-agent/review`) required the donor to click "Check with Sorting Agent," was purely advisory (could never block a submission even for a genuine hazard), and its reference was 8 hand-written paragraphs keyed strictly to the food_type dropdown. Replaced entirely (§7.7) with an automatic, instant check that runs on every submission server-side: a 12-category standardized corpus with real numeric thresholds (perishable/not, cold-chain requirement, safe hours by storage type) grounded in Singapore Food Agency and FDA/USDA guidance, retrieved against the donor's actual free-text item name rather than trusting the dropdown alone, with a deterministic safety floor Gemini may only escalate, never soften. A `bad` verdict now rejects a submission outright — the first and only AI-driven decision in Bitewise allowed to block rather than advise, justified because the risk (foodborne illness) is categorically different from a routing choice.
- ~~Staff had no visibility into food-safety concerns at approval time~~ → `warning`-tier donations now carry a visible flagged badge (`FoodSafetyBadge`) on `/approvals` and `/item/[id]`, shown before the branch-routing breakdown — staff can still approve, but never without seeing it. Caught and fixed one real bug in the same pass: `POST /api/approvals/[id]/approve` reconstructs `decision_details` from scratch for its own routing fields, which silently dropped `food_safety_check` on every approval until the route was fixed to explicitly carry it forward from the stored decision.

### Resolved since v2.0 (v2.1 — real-world demand-quota allocation)

- ~~Partner beneficiaries were only ever a reactive fallback~~ → The product previously modeled Willing Hearts as branch-matching first, with partner orgs receiving food only after a 3-hour unclaimed public-listing window. Researching how Willing Hearts and Food Bank Singapore actually operate showed this is backwards: both route to registered partners **by declared daily demand quota** before anything reaches the public. Section 7.6 makes demand-quota allocation the primary channel at approval time; public listing is now the fallback for whatever no partner still has quota room for. Reused Jain's Fairness Index (§7.4) unchanged, one layer downstream, so partner-network fairness is measured the same way branch-load fairness always has been.
- ~~No visibility into partner beneficiary fulfilment~~ → New `GET /api/beneficiaries` endpoint and `/dispatch` "Beneficiary Network" panel show each partner's quota fill and an overall fairness gauge; `/item/[id]` shows which partner a specific donation went to and why (need/proximity scores) via a new `BeneficiaryAllocationCard`.

### Resolved since v1.6 (v2.0 — full visual redesign)

- ~~Dark cosmic-glass theme~~ → Replaced entirely with an editorial-light theme on user request ("make it like Apple's website," researched live against garryaudie.com): warm off-white canvas (`#f5f5f4`), flat white cards with soft shadows (no blur, no glass), near-black text, solid-black pill buttons, pill-shaped badges. Every design token in `app/globals.css` was rewritten; because the app is built entirely on shared tokens/classes rather than per-component colors, this cascaded correctly to all 9 pages with only a handful of components needing individual fixes (a few hardcoded `rgba(255,255,255,…)` values that assumed a dark background — `Header`, `Sidebar`, `DonorCard`, `FairnessGauge`, `NgoSaturationBar`). The Leaflet basemap switched from CARTO `dark_all` to `light_all` to match.
- ~~Colour-gradient borders~~ → Removed entirely, not just recolored. The primary bento card's accent-gradient glow border, the logo mark's animated gradient, and the `--accent-gradient` CSS custom properties are gone; `variant="primary"` is now distinguished by shadow depth alone.
- ~~Supply chain plan (and everything else) lived behind a click-to-expand dropdown~~ → Fixed. Every donation now has its own dedicated page at `/item/[id]` (§11.2) — reached from the dashboard feed, the Agent Decision Log, and any traceable `/storage` item. Nothing expands in place anymore; `DonationFlowPanel`'s rows and `/agents`' decision cards are plain links. Backed by a new `GET /api/listings/[id]`, sharing its stage-derivation logic with `/api/pipeline` via `lib/pipeline.ts` so the two can never disagree.
- ~~A visible seam where the supply chain timeline's fade-to-scrollable-content effect met a non-white background~~ → Found live, immediately after building the detail page: `.route-ribbon::after` fades to `var(--bg-surface)` (white), but the detail page rendered `SupplyChainPlan` directly on the page's off-white canvas rather than inside a white card, producing a visible rectangular seam. Fixed by wrapping it in a `GlassCard`, matching how every other consumer of the component already presented it.

### Resolved since v1.5

- ~~Claiming an item was never actually "marked" in any durable way~~ → Fixed. The claim lifecycle previously stopped at `reserved` forever — there was no way to confirm a pickup (`ClaimStatus: 'picked_up'` and `InventoryStatus: 'distributed'` were both unreachable in every code path), and the *recipient's own* record of having claimed something lived only in React state, so a page refresh silently lost it (the item then vanished from view entirely, since the list only ever showed `in_stock` items). Fixed on both ends: `POST /api/claims/[id]/pickup` closes the loop (§10 above); `app/recipient/page.tsx` now persists claimed item ids to `localStorage` and keeps showing an item the current browser claimed regardless of its status, so "you reserved this" — and later "you picked this up" — survives a reload instead of disappearing. `FoodCard` gained a visible "Reserved by you" / "Picked up" badge (previously the only signal was disabled-button text) and a dedicated picked-up closure card. `/storage` gained a "Mark picked up" action and a real "Picked up" badge instead of an unreachable code path.
- ~~A picked-up item would have kept counting toward rack occupancy and "items held" forever~~ → Caught while building the above, before it shipped: once `distributed` became a reachable status, the zone occupancy math (`used_kg`, `item_count`, `total_items`) needed to explicitly exclude it, since a picked-up item has physically left the branch. It still renders in the item list with its badge (an audit trail, not hidden), just no longer occupies modeled capacity.
- ~~4-digit+ stat numbers could overflow the mobile stat cards~~ → Found via a full 9-page × 2-viewport regression sweep (the first time all pages were swept together since the Command Center and color-pass changes): `CO₂ Avoided` showing `2,917.5` pushed `StatCard` 18px past the mobile viewport, because the card's grid item had no `min-width: 0` and a `text-display`-sized number has no internal wrap point. One-line fix; every other page/viewport combination was already clean.
- Verified via a full live pass (not just unit tests): the full donation lifecycle end-to-end (submit → approve → dispatch → deliver → public list → claim → persist-across-reload → staff-confirm-pickup → recipient sees closure), concurrent-claim race (one 200 / one 409, exactly one `claims` row), concurrent-pickup race (one 200 / one 409, exactly one `distributed` row), and input validation (malformed UUID, missing fields, nonexistent item — all fail closed without crashing).

### Resolved since v1.4

- ~~Every "everything is fine" state was colored the same as things that actually needed attention~~ → Fixed on user feedback that the app felt like "too many colours." Applied one rule everywhere: color is reserved for what needs a look; a normal/expected state renders in neutral text so the genuine warnings stand out instead of competing with them. Concretely: `/storage`'s in-range temperatures and racks with room to spare (previously green) are now neutral — only "filling up," "rack full," and "over capacity" keep color; `badge-stable` (shelf-life "plenty of time left") is now `badge-neutral` on `/storage`, `/dispatch`, and the public `FoodCard`; idle vehicles on `/logistics` and the dashboard's `FleetSummaryPanel` are neutral, not green, and an idle *count* only turns red at zero, never green when nonzero; a donor's reliability badge only shows color below 75% instead of every donor getting a colored badge; `/dispatch`'s "People reached" and "At risk" stats dropped their unconditional/inverse-unconditional green. Deliberately left alone: AI-attribution badges ("AI-planned," "AI-drafted," "Chosen," "N branch agents ran") — those are meaningful positive facts worth highlighting, not decorative fine-state noise, so they keep their color.

### Resolved since v1.3

- ~~Viewing an already-generated supply chain plan required clicking "Plan the supply chain" again~~ → Fixed. The plan is generated once and cached permanently on the listing (`decision_details.supply_chain_plan`), but the UI still gated it behind a button click every time a card was reopened. `SupplyChainPlan` now accepts a `cachedPlan` prop from the caller (which already has `decision_details` in hand) and renders it immediately — the button only appears for a listing that has genuinely never been planned.
- ~~The plan's stage list was a static vertical rail with no connection to what's actually happening~~ → Fixed. Replaced with a horizontal, clickable timeline (`StageTimeline` + `StageDetail` in `SupplyChainPlan.tsx`): one node per planned hop, click any node to read its detail, and the donation's real live stage (from `/api/pipeline`) marks nodes done/current/upcoming and opens on the furthest-reached one by default — so opening a donation shows where the food actually is with zero clicks, not just what was originally planned.
- ~~A plan's contingency stage could render as "current" alongside the real listing stage~~ → Fixed during the same pass. Contingency is a conditional fallback, not a sequential hop, so ranking it level with `listing` made it look "reached" the moment food went on the shelf, even though nothing had actually been escalated. Ranked it above every real stage so it only ever renders as upcoming/informational, never as done or current.

### Resolved since v1.2

- ~~Command Center was three separate, disconnected panels~~ → Fixed. Replaced `PendingApprovalsPanel` with `DonationFlowPanel` — one feed of recent donations, each showing its real stage and expandable in place into either the approval flow or the live journey (route, vehicle, supply-chain plan), backed by the new `/api/pipeline` endpoint. Fleet and storage overviews remain alongside it for what isn't tied to a single donation.
- ~~Primary accent was a 4-stop rainbow gradient (cyan/violet/pink/amber)~~ → Fixed on user feedback that it read as generic/AI-generated. Replaced with a restrained two-stop gradient between the app's own existing accent blue and info violet (`--accent-gradient`, `#0a84ff → #6e5ce6`), applied in the same deliberately sparse way (primary CTA, one bento card border, the fairness gauge arc) — same restraint philosophy, cohesive rather than novel hues.
- ~~Some dashboard list rows used flat tinted backgrounds instead of glass~~ → Fixed. `FleetSummaryPanel` and `StorageSummaryPanel`'s item rows now use `GlassCard variant="nested"` like the rest of the app, instead of a plain `var(--bg-hover)` div.

### Resolved since v1.1

- ~~Network Overview was read-only~~ → Fixed. `/orchestrator` now embeds a Command Center (`components/dashboard/{PendingApprovalsPanel,FleetSummaryPanel,StorageSummaryPanel}.tsx`) so approving a donation, advancing a fleet run, and spotting near-expiry stock no longer require leaving the page. `ApprovalCard` was extracted out of `/approvals` into `components/dashboard/ApprovalCard.tsx` and is now shared verbatim by both surfaces, so the two never drift. Live-tested end-to-end (simulate → approve → dispatch → advance through all 3 fleet states → arrival) via the dashboard's own buttons with zero console errors.
- ~~SVG `<title>` inside `FairnessGauge` caused a hydration mismatch~~ → Fixed by removing it; the enclosing `<svg>`'s `aria-label` already carried the same (fuller) text, so no accessibility regression. React 19 hoists `<title>` elements toward the document head as an SEO resource, which can diverge between server and client render even inside an SVG — the fix is to not put one there.

### Resolved since v1.0

These were open limitations in the previous revision and have since been fixed and verified live:

- ~~Mobile responsiveness broken on every NGO page~~ → Fixed. The sidebar is now an off-canvas drawer below 1024px driven by a shared `AppShell`, and every fixed-column grid (stats, map+rail, score table, action buttons) has responsive rules. Verified at 1440×900 and 390×844: **0px horizontal overflow on all 7 pages, zero console errors.**
- ~~Donor find-or-create race~~ → Fixed. `005_donor_name_unique.sql` adds a case-insensitive, whitespace-trimmed unique index; the route now inserts optimistically and adopts the winning row on a `23505` conflict instead of failing the submission (see limitation 3 for the migration caveat).
- ~~Approve button not disabled with zero candidates~~ → Fixed. `/approvals` disables the action and labels it "No branch available" when no branch is eligible, instead of letting a staffer click into a `409`.
- ~~Agent tool calls captured but discarded~~ → Fixed. Tool traces are now persisted on each candidate and rendered as an expandable, per-agent audit trail (Section 8.6).
- ~~Redundant duplicate tool calls~~ → Fixed. Gemini's automatic function calling sometimes re-ran the entire tool set for a second round, producing six identical calls where three were meaningful. Tools are now memoised per decision (Section 8.6).

---

## 16. Out of Scope / Future Work

- Real authentication + role-based access (NGO staff vs. public) — see Limitation 1.
- Mobile-responsive NGO layout — see Limitation 2.
- Real courier/logistics dispatch integration (currently: status field only, no actual routing/tracking).
- Multi-organization support (routing across charities, not just within one charity's own branches).
- A proper RAG/embeddings pipeline for food-safety knowledge, if the category count grows well beyond the current 8 hand-authored entries.
- Configurable matching weights (currently a single hardcoded `DEFAULT_MATCH_WEIGHTS`) — could become an NGO-configurable setting per branch or per network.
- Push notifications / SMS for donors and recipients (e.g. "your donation was approved," "an item near you is about to expire").
- Historical analytics / trend charts beyond the current point-in-time dashboard (Recharts is already a dependency, underused).

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Branch** | One of Willing Hearts' 5 physical outlets (Woodlands, Toa Payoh, Bukit Merah, Yishun, Tampines). |
| **Donor** | A business (or the public form's submitter) contributing surplus food. |
| **Listing** | A single donation offer (`food_listings` row), from submission through its final resolved status. |
| **Branch Coordination Agent** | A per-branch Gemini agent with real function-calling tools that assesses whether its branch should take a given donation. |
| **Network Coordinator Agent** | The Gemini agent that reviews every Branch Coordination Agent's report and makes the final routing call. |
| **Shortlist** | The top 3 branches by deterministic pre-score, chosen to receive real AI agent attention (quota-conservation measure). |
| **Supply Chain Planner Agent** | The agent that plans everything downstream of the routing decision — transfer, storage, listing window, escalation, and the partner beneficiary of last resort. |
| **Partner beneficiary** | A local organisation (family service centre, soup kitchen, shelter, senior care hub, children's home, dormitory kitchen) that receives food directly, either by demand-quota allocation at approval time or reactively if nobody claims it publicly in time. Defined per branch region, including its registered `daily_quota_kg`, in `lib/data/beneficiaries.ts`. |
| **Demand-quota allocation** | The primary partner-beneficiary channel (§7.6): at approval time, a donation is routed to whichever eligible partner has the most unmet need relative to its own registered daily quota — the real-world Willing Hearts/Food Bank Singapore mechanic. Falls through to public listing only when every eligible partner is already at quota. |
| **Food-safety verdict** | The standardized `good`/`warning`/`bad` outcome (§7.7) every donation is scored on before a listing exists. `bad` rejects outright; `warning`/`good` proceed with the verdict visible to staff at approval. |
| **Safety floor** | The deterministic verdict computed from the retrieved food-safety category before Gemini is ever consulted — the AI may escalate it to something more severe but can never report a less severe verdict. |
| **Escalation** | The *reactive* fallback: the lazy transition of near-expiry unclaimed public inventory to partner-beneficiary-routed, after `ESCALATION_THRESHOLD_HOURS`. Secondary to demand-quota allocation as of v2.1 — reuses the same `'escalated'` inventory status either way. |
| **Jain's Fairness Index** | A single number (0 to 1) measuring how evenly load is distributed across branches relative to their capacities. |
| **Decision transcript / `decision_details`** | The full, persisted record of a matching decision — every candidate branch's scores (and AI rationale, if applicable), excluded branches, and the final chosen branch. |
| **Recipient profile** | A claim's lightweight identity as of v2.3 (§7.8) — a name and optional phone, not authentication. Created once via `POST /api/profiles`, persisted client-side, reused for every future claim. |
| **Pickup countdown / `pickup_deadline_at`** | How long a recipient has to physically collect a claimed item, agent-computed at claim time from its real remaining shelf life (§7.8) — never a fixed constant. Miss it and the reservation releases itself automatically. |
| **One-active-claim rule** | A recipient profile can hold only one `'claimed'`-status reservation at a time (§7.8) — enforced in `POST /api/claims` before the item itself is touched. |

---

## 18. Appendix: Environment & Deployment

### Required environment variables (`.env.local`)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (client-side reads, subject to RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key used by all API routes (bypasses RLS) — **never expose client-side** |
| `GEMINI_API_KEY` | Google Gemini API key. If unset, the app runs fully functional with the AI layer disabled — every AI-assisted feature degrades to its deterministic/disabled counterpart, flagged transparently in the UI. |
| `NEXT_PUBLIC_SITE_URL` | Base site URL |

### Database setup order

1. `supabase/schema.sql` — base tables, indexes, RLS policies.
2. `supabase/seed.sql` — 7 seed donors, 5 branches, 9 seed inventory items.
3. `supabase/migrations/002_approval_workflow.sql` — approval workflow columns + widened donor types.
4. `supabase/migrations/003_escalation.sql` — `'escalated'` inventory status.
5. `supabase/migrations/004_atomic_increments.sql` — atomic increment RPC functions (**required** before `/api/approvals/[id]/approve` will work — it 500s without this).
6. `supabase/migrations/005_donor_name_unique.sql` — case-insensitive unique donor-name index that makes the donor find-or-create guard atomic. The app runs correctly without it, but the race described in [Known Limitations](#15-known-limitations--risks) stays open until it's applied.
7. `supabase/migrations/006_fleet.sql` — `vehicles` + `fleet_runs` tables and a seeded 12-vehicle fleet. Without it, `/logistics` shows a setup message and `/dispatch` omits vehicle suggestions; everything else works.
8. `supabase/migrations/007_inventory_provenance.sql` — adds `inventory_items.listing_id`, linking stock back to the donation that produced it. Without it there is no donor provenance and the public list can't show delivery progress (every item reports as already at the branch); both `/api/inventory` and `/api/storage` detect the missing relationship and fall back to serving without those fields rather than failing.
9. `supabase/migrations/008_beneficiary_allocations.sql` — `beneficiary_allocations` table backing demand-quota allocation (Section 7.6). Without it, `/api/approvals/[id]/approve` skips demand-quota allocation entirely and every donation falls back to public `in_stock` listing — the pre-v2.1 behavior, not a crash — and `/api/beneficiaries` reports `tracking_available: false` with every partner reading as 0% fulfilled.
10. `supabase/migrations/009_recipient_profiles.sql` — `recipient_profiles` table plus `claims.profile_id`/`claims.pickup_deadline_at` (Section 7.8). Without it, `POST /api/profiles` fails and the client falls back to a local-only identity; `POST /api/claims` falls back to an insert without the new columns — claiming still works, just fully anonymous again with no one-active-claim limit and no pickup countdown, not a crash.

Run `npm run check:migrations` at any time to see which of these are actually applied to the live project.

### Local development

```bash
npm install
npm run dev        # next dev, Turbopack
npm run lint       # eslint
npm test           # vitest — algorithm unit tests
npm run test:watch # vitest in watch mode
npm run build      # production build + typecheck
```

### Verification status (as of v1.1)

Verified live against the real Supabase project and a real Gemini key:

| Check | Result |
|---|---|
| Lint / typecheck / production build | clean |
| Unit tests | 22/22 passing |
| All 7 pages, desktop (1440×900) + mobile (390×844) | 0px horizontal overflow, 0 console errors |
| Public donate → sorting agent → submit | agent correctly flagged dairy declared ambient with a 72h window, suggested cold + 2h |
| Approve → inventory + branch load + donor total + fairness snapshot + audit entry | all consistent, arithmetic verified against the database |
| Two concurrent approvals of one listing | 1× `200`, 1× `409`; exactly one inventory row, one audit entry, load incremented once |
| Two concurrent claims of one item | 1× `200`, 1× `409`; exactly one claim row |
| AI fallback (key removed) | `used_ai_agents: false`, honest banner shown, routing still correct, nothing blocked |
| Tool-call traces | rendered per agent with raw returned values |
| Mobile drawer nav | opens, navigates, auto-closes |
| Supply chain planner (SSE) | prep steps stream instantly, ~3s real gap for the model call, plan renders; cached replay costs no Gemini call |
| Planner grounding | plan cited the real 10.58km distance, real cold-storage capability, real zero-competing-stock, real 3h threshold, and a validated partner |

All test data created during verification was removed afterward and branch loads restored to their pre-test baselines.
