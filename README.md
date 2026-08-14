# Bitewise

Bitewise is the software Willing Hearts uses to run its own branch network. Willing Hearts operates 5 branches across Singapore — Woodlands, Toa Payoh, Bukit Merah, Yishun, and Tampines. When a donor (supermarket, hotel, restaurant) has surplus food, Bitewise decides which branch should receive it based on:

1. **Proximity** — closer branches mean less transit time and less spoilage risk in transit.
2. **Fairness** — branches with more free capacity relative to their size are prioritized, so no single branch is overwhelmed while others sit empty (measured with Jain's Fairness Index).
3. **Spoilage risk** — a branch that already has a glut of the *same food type* expiring soon is penalized, even if it's the nearest, emptiest branch. This avoids concentrating perishables that will go to waste together.

Recipients can browse and claim available food from any branch with zero login and zero personal data collected.

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (PostgreSQL + Realtime)
- Leaflet / react-leaflet (CartoDB Dark Matter tiles)
- Recharts, Framer Motion, Lucide React
- Zod, date-fns

## Getting Started

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) (Southeast Asia / Singapore region recommended). In the SQL Editor, run, in order:

1. `supabase/schema.sql` — tables, indexes, realtime publication, row-level security
2. `supabase/seed.sql` — 7 donors, 5 Willing Hearts branches, 9 starting inventory items

Right before a live demo, optionally also run `supabase/historical.sql` to backfill 15 delivered listings so the dashboard doesn't start at zero.

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your real values from Supabase (Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`.env.local` currently contains placeholder values so the app builds without crashing — replace them before running against real data. The service role key is only ever read on the server (`lib/supabase-server.ts`); the anon key is used client-side for the orchestrator page's realtime subscription. `GEMINI_API_KEY` powers the Sorting Agent's advisory food-safety check on `/donate` (get one at [aistudio.google.com](https://aistudio.google.com/apikey)) — without it, that check just reports itself as unavailable and donors can still submit normally.

### 3. Install and run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` — it redirects to `/orchestrator`.

## Pages

| Route | Description |
|---|---|
| `/orchestrator` | Network Coordinator Dashboard — map, Jain's Fairness gauge, branch saturation bars, Simulate button |
| `/donors` | Donor CRM — every donor with an auto-generated impact summary |
| `/storage` | Branch inventory grouped by branch, sorted by expiry urgency |
| `/recipient` | Public, anonymous food browser — no login, no personal data |

## Core algorithms

- `lib/algorithms/jain-fairness.ts` — Jain's Fairness Index across the 5 branches' load ratios.
- `lib/algorithms/matching.ts` — spoilage-aware matching: scores each eligible branch on proximity, fairness need, and spoilage risk (how much of the same food type is already expiring soon at that branch), then picks the highest-scoring branch.
- `lib/utils/geo.ts` — Haversine distance between donor and branch.

## API routes

- `GET /api/fairness` — branches, Jain index, total rescued kg, meals/CO₂ equivalents, active deliveries
- `POST /api/match` — runs the matching algorithm, updates branch load, inserts a food listing + inventory item, snapshots fairness, writes an audit log entry
- `GET /api/donors` — all donors
- `GET /api/inventory` — inventory items joined with branch info, sorted by expiry
- `POST /api/claims` — anonymous claim on an inventory item

## Deploying

```bash
git init
git add .
git commit -m "Bitewise submission"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bitewise.git
git push -u origin main
```

Then on Vercel: import the repo, add the same environment variables, deploy.
