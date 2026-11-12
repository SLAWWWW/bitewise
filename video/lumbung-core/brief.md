# Lumbung — Every hand-off, accounted for

Final direction: a text-led product film with no voiceover, following the user's preference. Exactly 60 seconds, 1920 × 1080, 30 fps. Deliver an original-score edition and a silent edition.

Audience: food-rescue coordinators and potential pilot partners. Main idea: one donation becomes an explained allocation and an accountable delivery.

## Art direction

Obsidian black, luminous white, silver-gray depth, Geist typography, and rotating abstract routing geometry. Meaningful motion carries the story: unsuitable recipients are excluded, an explained match remains, two human approval gates release the donation, and evidence completes the journey.

Real Lumbung screenshots provide product evidence. Demo captures are labeled. The three-recipient example is illustrative; the orbital form is abstract, not a geographic coverage claim. No fictional live AI, live messaging, measured impact, or partner testimonials.

## Final sequence

| Time | Scene | Visible explanation |
| --- | --- | --- |
| 0–5s | 10 portions. 3 recipients. One decision. | One donation connects to three possible destinations. |
| 5–9s | Meet lumbung. | Product reveal within rotating routing geometry. |
| 9–15s | Start with the essentials. | Real form with food, quantity, and collection-window spotlights. |
| 15–22s | Nearby isn't enough. | Zero capacity and an expired agreement exclude two recipients. |
| 22–29s | See the match. Understand the why. | Real demo recommendation with quantity, score, and decision factors. |
| 29–37s | People stay in control. | Outreach approval, confirmed logistics, then delivery approval. |
| 37–43s | Direct or via warehouse. | Two supported routes; the token follows one route. |
| 43–50s | Proof completes the delivery. | Receipt, evidence, and missing-report follow-up. |
| 50–56s | One donation. A traceable journey. | Connected record from intake through evidence. |
| 56–60s | Every hand-off, accounted for. | Brand close with a readable final hold. |

## Evidence ledger

- Current implemented scope: repository README; persistent P0 simulation. Live model, messaging, and registry integrations are disabled.
- Eligibility and capacity: `src/domain/allocation/planner.ts`, including capacity exclusions and candidate scoring.
- Explained recommendation: `app/(ops)/rekomendasi/[id]/page.tsx`; actual demo recommendation for 10 portions, captured for the landing page.
- Separate approvals and logistics: `tests/e2e/direct-donation.spec.ts` and implementation status in the README.
- Receipt, evidence, reporting, and audit: implemented direct-donation flow and reporting pages.
- New screenshots: local Playwright captures using the demo coordinator. The quantity was entered but no donation was submitted.

## Production

`timeline.json` defines authored scene timing. `render.py` evaluates frames deterministically and composes an original instrumental track. No speech timing, voice identity, speech service, or narration approval is involved. Outputs remain local; nothing is published.
