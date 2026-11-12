# Visual guide verification — 11 November 2026

Verified on 1440 px desktop and 390 px mobile Chromium.

- `npm run typecheck`: passed. The final production build also passed TypeScript.
- `npm run lint`: passed.
- `npm test`: 349 tests passed across 37 files.
- `npm run test:e2e`: all 26 desktop/mobile tests passed using an isolated database,
  production web server, and worker. This includes the existing donation, warehouse,
  and spotlight walkthrough journeys.
- After the last selected-label contrast refinement, all 8 visual-guide browser
  tests and the production build passed again, including the intermediate safety step.
- Production Webpack build: passed as part of the isolated browser suite.
- `git diff --check`: passed.

The new browser checks visit all six diagrams, select nodes, inspect implementation
references, scan for accessibility violations, check viewport overflow, and verify
the six-diagram Markdown/Mermaid download. They also verify English, keyboard
navigation, manual stepping, paused playback, reduced-motion compatibility, stable
mobile detail positioning, authenticated access, and role-aware screen links.

The guide issues no operational API mutations. A second isolated server with
`PROTOTYPE_GUIDE_ENABLED=false` verifies both hidden navigation and HTTP 404 for a
direct `/panduan` request. Unit tests verify that either a LIVE process or LIVE
tenant blocks the guide even with explicit opt-in, and that every displayed source
reference exists in the checkout.

Visual review found and corrected a transient text-contrast issue during selection
and a mobile scroll issue when a previous inline explanation collapsed. Final
viewport captures are retained locally under `.data/visual-guide/`; the browser
suite's captures and documentation exports are under `test-results/`.

The diagrams are explanatory documentation of the prototype. They do not display
live queue counts, execute a workflow, assert production integrations, or replace
the operating screens. No database migration is required. The standalone database
test suite was not rerun for this UI/documentation change; the browser suite uses
the existing migrations and exercises real persisted operations in its disposable
database.
