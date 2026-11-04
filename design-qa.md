# Landing design QA — 2026-11-04

final result: passed

## Source visual truth

The five user-supplied screenshots in `/Users/radoslawaryananda/Desktop/`:

- `Screenshot 2026-11-04 at 1.28.58 PM.png`: Supabase product grid.
- `Screenshot 2026-11-04 at 1.29.16 PM.png`: Cloudflare network globe and feature row.
- `Screenshot 2026-11-04 at 1.29.23 PM.png`: Cloudflare two-column contrast section.
- `Screenshot 2026-11-04 at 1.30.28 PM.png`: n8n pill navigation, dotted hero, connected workflow.
- `Screenshot 2026-11-04 at 1.31.31 PM.png`: n8n light section with floating integration icons.

## Implementation and capture conditions

- Local URL: `http://localhost:3000/`.
- Browser: project Playwright Chromium, explicitly authorized by the user earlier in this conversation.
- Desktop: 1512 × 860 CSS pixels, deviceScaleFactor 1; screenshots 1512 × 860 pixels.
- Mobile: 390 × 844 CSS pixels, deviceScaleFactor 1; screenshots 390 × 844 pixels.
- Source screenshots are approximately 3024 × 1720 pixels. Each was normalized to a 1512 × 860 canvas with `contain` before comparison. Small source chrome differences were excluded from findings.
- Additional browser checks cover 320, 768, and 1512 CSS-pixel widths, and the existing desktop/mobile test projects.
- State: public landing, signed out. The initial redesign selected Human approval; the motion revision starts at Safety floor and advances through the five steps. Section captures use the corresponding scroll position. Mobile adaptation is evaluated for usability because the user provided desktop references only.
- Product previews are screenshots of the actual synthetic DEMO workspace. The current Lumbung name, original pitch topics and copy are retained. Other companies' names, logos and product copy are intentionally replaced. This is a composite redesign from five references, not a pixel-for-pixel clone of a single page.

## Evidence

Full-view combined reference/implementation comparisons (source on left, implementation on right):

- `.data/landing-review/compare-hero.png`
- `.data/landing-review/compare-network.png`
- `.data/landing-review/compare-product.png`
- `.data/landing-review/compare-status.png`
- `.data/landing-review/compare-closing.png`

Focused comparison evidence (source above implementation):

- `.data/landing-review/focus-nav.png`: wordmark, font treatment, pill outline, links and primary CTA.
- `.data/landing-review/focus-cards.png`: icon, card heading, description and contrast.

Implementation captures: `.data/landing-review/{desktop,mobile}-{hero,problem,network,product,status,closing}.png`. These are local QA artifacts, excluded from source control. Reference and rendered output were opened together in each combined image before judging.

## Comparison history and resolved findings

1. **P2 — Hero height:** The first implementation's large three-line headline pushed the selected workflow explanation beyond the initial desktop viewport. Reduced desktop heading to 66px maximum, shortened hero padding and workflow gaps. Latest `compare-hero.png` shows the complete interactive explanation and guidance within 860px. The extra heading line versus n8n is intentional to retain Lumbung's longer copy.
2. **P2 — Globe background:** Screen blending brightened the image's dark rectangular background. Switched to lighten blending, resized the globe composition, and restored surrounding dotted rails. Latest `compare-network.png` and `mobile-network.png` show seamless dark edges, readable callouts, and the feature row.
3. **P2 — Closing surface:** The first closing section repeated the hero dots. Restored the reference's plain light field around the floating icons. Latest `compare-closing.png` shows the corrected surface.
4. **P1 — Roadmap contrast:** Axe found the large phase numbers at 2.22:1 contrast. Darkened them from #aaa to #808080. The subsequent full desktop/mobile suite passed, including the contrast check.
5. **P2 — Asset sizing:** The first dashboard capture included the entire long dashboard. Cropped the real screenshot to 1280 × 770, compressed it, and used static image imports so intrinsic dimensions are correct. Latest product capture shows a clear cropped product preview; total landing image assets are approximately 270 KB before Next image resizing.
6. Final refinement: connected workflow controls now use stretched library arrow icons with non-scaling strokes. Network top spacing keeps its section label clear of the sticky navigation. The final hero and network captures were reviewed after these edits.

## Required fidelity surfaces

- **Fonts and typography:** Local Geist variable font throughout, including controls. Reference-like geometric sans display headings, tight tracking, regular/medium weights, muted secondary lines, and small uppercase navigation. The header is slightly taller than the reference to support 42–48px targets. Card text remains larger than the compact reference for readability. No clipped headline or control labels at checked widths.
- **Spacing and layout rhythm:** Centered pill header; spacious hero with functional workflow nodes; thin rules; dark globe section with three columns; two primary product cards over four compact cards; large split status panel; floating-icon closing section. Layouts stack on phones. No horizontal overflow at 320, 390, 768, 1440, or 1512px in browser checks.
- **Colors and tokens:** Neutral black, white and gray throughout. Orange, green, pink and colored integration logos from the references are intentionally removed. White/black primary actions and explicit selected/focus states remain visible. Roadmap contrast issue fixed.
- **Image quality and asset fidelity:** Actual supplied brand mark, a source-extracted dot tile, current demo product screenshots, and a built-in Image Gen globe. No fake screenshot placeholders or handwritten SVG illustrations. Globe provenance and exact prompt: `public/landing/asset-notes.md`; final generated asset: `public/landing/network-globe.webp`. Lucide library icons match the references' thin outlined style. Native image dimensions prevent incorrect aspect ratios; decorative crops are intentional.
- **Copy/content:** Existing Lumbung pitch, statistics, workflow descriptions, organisation list, policy phase-in text, implementation status list, roadmap and CTAs preserved. New short navigation/card labels point to real current routes. Product screenshots replace the obsolete Singapore branding. This task preserves the supplied copy; it does not independently verify its product or legal claims.

## Interaction and engineering checks

- Workflow step selection by pointer and keyboard; ArrowLeft/ArrowRight, Home/End, correct focus and selected panel.
- Mobile menu opens/closes, follows section links, supports Escape and returns focus.
- Primary product CTA reaches the existing sign-in flow; new-donation CTA points to `/donasi/baru`.
- Images load successfully; browser page errors monitored with none observed.
- Whole-page Axe accessibility check, responsive overflow checks, and screenshots in the landing Playwright tests.
- Existing operations, donation, warehouse and spotlight-guide flows included in the full suite.
- 342 unit tests passed; full browser suite 24 passed. Typecheck, lint, whitespace checks, and production build passed. The final focused browser run passed all 6 landing checks after the asset/control refinements, including whole-page accessibility.
- Landing styling moved from globals into a scoped CSS module; obsolete landing reveal/count-up components removed. Core content remains server-rendered; navigation and interactive explainer are small client components.

## Remaining findings

No actionable P0/P1/P2 design findings remain. Actual app screenshots have light surfaces inside dark preview cards, intentionally preserving the working product rather than reproducing another product's schematic mockups. Mobile layouts are adaptations of desktop-only references. No P3 item blocks handoff.

## Implementation checklist

- [x] Preserve Lumbung pitch content and current app routes.
- [x] Rebuild every public landing section in the requested monochrome design.
- [x] Review combined source/rendered comparisons and focused crops.
- [x] Fix contrast, image background, spacing and sizing findings.
- [x] Verify mobile, keyboard, accessibility, core links and operations regressions.
- [x] Leave the existing local development app running.

## Follow-up revision — layout and motion

The user's 13:56 attachment identified a clipped pipeline CTA and an empty recommendation preview. The same request added a revolving Earth and an animated transfer between the hero's nodes. Scope: refine these three existing surfaces while retaining the monochrome identity and pitch copy.

### Resolved findings

- **P2 — Clipped pipeline content:** Removed the fixed height and negative image crop. The card now uses an aligned two-column grid with equal outer padding and a contained preview frame; it stacks at tablet/mobile widths. Heading, link and image are inside the card at 320, 768 and 1512px.
- **P2 — Empty preview:** Replaced the empty-state capture with a real selected-FLO recommendation generated in an isolated test database. A 650 × 296 crop removes unused space without stretching or changing the screenshot text. Reused the app's exact localized quantity formatter on the recommendation detail page so capacity displays as `60 portions` instead of a long decimal string. Stored values and calculations are unchanged.
- **P2 — Static globe:** Added a lazily loaded COBE WebGL globe with Indonesia initially facing forward, monochrome dots and illustrative route arcs. The actual sphere rotates about once every 39 seconds. The generated illustration remains the no-WebGL fallback. Caption has an opaque surface so rotating dots cannot reduce its contrast.
- **P2 — Static workflow:** Aligned node centers and connectors, added a traveling marker, and advance the active node and its explanation every 3.6 seconds. Clicking or focusing a node stops automatic playback. Keyboard navigation and focus are preserved.
- **P1 — Motion control accessible name:** Axe caught a mismatch between the globe control's visible wording and its accessible name. Made the two match exactly; whole-page accessibility checks now pass on desktop and mobile.

Both animations have independent pause/play controls, respect reduced-motion preferences, and sleep offscreen or when the browser tab is hidden. Reduced-motion users can explicitly opt in with Play. These are explanatory animations and never execute operational actions.

### Revision evidence

Captured and inspected with the user-authorized Playwright browser at 1512 × 860 and 390 × 844 CSS pixels, deviceScaleFactor 1:

- `.data/landing-motion/compare-hero.png`: original n8n reference beside the updated hero, including the traveling marker.
- `.data/landing-motion/compare-network.png`: original Cloudflare reference beside the revolving globe section.
- `.data/landing-motion/pipeline-comparison.png`: original Supabase reference above the corrected pipeline card.
- `.data/landing-motion/{desktop,mobile}-workflow-{a,b}.png`: automatic progression at different times.
- `.data/landing-motion/{desktop,mobile}-globe-{a,b}.png`: different rendered Earth orientations two seconds apart.
- `.data/landing-motion/{desktop,mobile}-pipeline.png` and `pipeline-card.png`: final card spacing and readable populated preview.

The original Desktop source files were unavailable during this revision, so comparison sheets reuse their preserved, normalized source panels from the previous QA artifacts. The latest 13:56 attachment was inspected directly in the conversation for the reported clipping/empty-state defects. No replacement reference was invented. The combined reference/rendered images and mobile captures were opened before this assessment.

### Revision checks

- All 14 landing checks passed on desktop and mobile: responsive bounds, navigation, workflow keyboard input and automatic progression, pause/resume, focus preservation, reduced-motion opt-in, offscreen suspension, visible globe movement, frozen frames while paused, fallback without WebGL, asset loading, and whole-page Axe.
- Mobile globe verification captures the visible scene rather than the oversized sphere canvas; the latter intentionally extends beyond the viewport and caused inconsistent browser screenshot cropping. Paused scene images are identical across separate frames.
- Unit suite: 342 passed. Typecheck, lint, whitespace check and production build passed.
- Full application browser regression run: **32 passed**, including direct donation approvals and receipt, warehouse receiving, operations routes, list readability, and the spotlight walkthrough on desktop and mobile. The harness also completed a production build and removed its isolated database afterward.

No unresolved visual or interaction findings remain in the revised surfaces. Mobile product screenshots remain illustrative previews; the adjacent link opens the full interactive page.
