// Existing public pitch content, shared by the landing sections.
export const PROBLEM_STATS = [
  {
    value: null,
    display: "23–48M",
    unit: "tonnes a year",
    label: "Food wasted in Indonesia",
  },
  {
    value: null,
    display: "2nd",
    unit: "globally",
    label: "Largest food waster in the world",
  },
  {
    value: 23.36,
    decimals: 2,
    suffix: "M",
    unit: "people",
    label: "Below the national poverty line",
  },
  {
    value: 21,
    decimals: 0,
    suffix: "%",
    unit: "of under-5s",
    label: "Affected by stunting",
  },
];

export const INCUMBENT_TOOLING = [
  {
    org: "FoodCycle Indonesia",
    scale: "120+ donors · 100+ beneficiaries",
    tooling: "Zoho Creator forms",
  },
  {
    org: "Foodbank of Indonesia",
    scale: "39 locations · 4,454 volunteers",
    tooling: "Phone & WhatsApp",
  },
  {
    org: "Garda Pangan",
    scale: "113 tonnes over 5 years",
    tooling: "Basic app, low adoption",
  },
  {
    org: "Foodbank Bandung",
    scale: "Regional network",
    tooling: "Microsoft Excel",
  },
];

// ── The pipeline ────────────────────────────────────────────────────────────
export const PIPELINE = [
  {
    step: "01",
    title: "Safety floor",
    body: "A deterministic floor scores every submission. The AI can only make it stricter, never softer.",
  },
  {
    step: "02",
    title: "Fair matching",
    body: "Each branch is scored on real proximity, real spare capacity, and its own spoilage glut.",
  },
  {
    step: "03",
    title: "Human approval",
    body: "Nothing moves automatically. Allocations queue by what spoils soonest for a person to approve.",
  },
  {
    step: "04",
    title: "Plan & dispatch",
    body: "A planner builds the route against real fleet limits. Critical stock leaves the moment it’s approved.",
  },
  {
    step: "05",
    title: "Closed loop",
    body: "Collected, delivered, or recycled — every donation ends in a recorded, auditable outcome.",
  },
];

// ── Build status, stated honestly ───────────────────────────────────────────
export const BUILT = [
  "Six agents with real function-calling tool use",
  "Deterministic safety floor, AI escalate-only",
  "Fairness-weighted matching (Jain’s Index)",
  "Human approval gate on every allocation",
  "Demand-quota allocation to beneficiaries",
  "Immediate dispatch for time-critical stock",
  "Live ops dashboard, storage, fleet, audit log",
  "Deterministic fallback if AI is unavailable",
];

export const NEXT = [
  { label: "Bahasa Indonesia across every surface", priority: "P0" },
  { label: "WhatsApp-first donor flow with photo parsing", priority: "P0" },
  { label: "Donor legal protections at submission", priority: "P0" },
  { label: "Real authentication with role separation", priority: "P0" },
  { label: "Multi-organisation tenancy", priority: "P1" },
  { label: "Structured allergen declaration", priority: "P1" },
  { label: "Volunteer coordination module", priority: "P1" },
  { label: "Corporate ESG compliance export", priority: "P2" },
];

// ── Roadmap ─────────────────────────────────────────────────────────────────
export const PHASES = [
  {
    phase: "Phase 1",
    window: "Month 1–3",
    title: "Free pilot",
    body: "Embed inside one respected food-rescue organisation. Prove reduced spoilage and reclaimed staff time.",
    revenue: "Rp 0 — validation",
  },
  {
    phase: "Phase 2",
    window: "Month 4–8",
    title: "Monetise the charity side",
    body: "Convert the pilot to subscription; expand to a 39-location network.",
    revenue: "Rp 500K–1.5M / mo",
  },
  {
    phase: "Phase 3",
    window: "Month 6–12",
    title: "Corporate compliance",
    body: "Sell the audit trail to the corporate donors already flowing through the platform.",
    revenue: "Rp 5M–40M / mo",
  },
  {
    phase: "Phase 4",
    window: "Month 12–18",
    title: "Deep moat",
    body: "Verified cold chain, tamper-evident anchoring, shared routing intelligence.",
    revenue: "Network expansion",
  },
];

export const OJK_PHASES = [
  {
    group: "Group 1",
    who: "Main-board issuers, major banks",
    from: "Jan 2027",
    active: true,
  },
  {
    group: "Group 2",
    who: "Development-board issuers",
    from: "Jan 2028",
    active: false,
  },
  {
    group: "Group 3",
    who: "Asset managers, public-interest entities",
    from: "Jan 2029",
    active: false,
  },
];

