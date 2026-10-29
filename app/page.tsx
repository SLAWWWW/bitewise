import Link from "next/link";
import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  Boxes,
  Globe2,
  MapPin,
  ShieldCheck,
  User,
} from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";
import { CountUp } from "@/components/landing/CountUp";

/**
 * Lumbung's public landing page — the pitch surface.
 *
 * Its own visual register, separate from the product it sits in front of:
 * glassmorphism on a white canvas. One animated black gradient field drifts
 * behind the entire page (one `.lp-wave`, see globals.css) and every surface
 * above it is translucent glass that blurs it, so depth comes from blur and
 * light rather than from borders. Structure comes from hairline outlines —
 * dashed frames with corner ticks, dotted page rails, ruled column joins.
 *
 * The hero is one full screen of type over a stronger local bloom. Everything
 * after it is a single continuous page (no per-screen slides): blocks
 * separated by hairlines, in normal document scroll.
 */

// ── The scale of the problem ────────────────────────────────────────────────
const PROBLEM_STATS = [
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

const INCUMBENT_TOOLING = [
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
const PIPELINE = [
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
const BUILT = [
  "Six agents with real function-calling tool use",
  "Deterministic safety floor, AI escalate-only",
  "Fairness-weighted matching (Jain’s Index)",
  "Human approval gate on every allocation",
  "Demand-quota allocation to beneficiaries",
  "Immediate dispatch for time-critical stock",
  "Live ops dashboard, storage, fleet, audit log",
  "Deterministic fallback if AI is unavailable",
];

const NEXT = [
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
const PHASES = [
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

const OJK_PHASES = [
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

const SHOTS = [
  {
    src: "/screenshots/dashboard.png",
    w: 1370,
    h: 560,
    cap: "Live operations — fairness, saturation, deliveries in flight",
  },
  {
    src: "/screenshots/agents.png",
    w: 1370,
    h: 340,
    cap: "The agent pipeline, with every tool call inspectable",
  },
  {
    src: "/screenshots/donate.png",
    w: 1600,
    h: 900,
    cap: "Donor submission — safety-checked before a listing exists",
  },
];

const TICKER_ITEMS = [
  "ZOHO CREATOR FORMS",
  "MICROSOFT EXCEL",
  "PHONE & WHATSAPP",
  "BASIC APP, LOW ADOPTION",
  "PAPER LOGBOOKS",
];

/**
 * Nodes on the dotted map. The SVG's viewBox is lng 94.5..141.5 by lat
 * 6.5..-11.5, so a real coordinate converts to a percentage of the map box
 * as x = (lng - 94.5) / 47 and y = (6.5 - lat) / 18. The values below are
 * actual Indonesian cities put through that, so the pins land on land.
 */
const MAP_NODES = [
  { x: 21.7, y: 52.8, icon: User, label: "Palembang" },
  { x: 26.2, y: 70.6, icon: Boxes, ink: true, label: "Jakarta hub" },
  { x: 53.0, y: 64.4, icon: User, delay: true, label: "Makassar" },
  { x: 90.2, y: 61.1, icon: User, label: "Timika" },
];

/**
 * Routes between those nodes, drawn in the map SVG's own coordinate space
 * (x = lng, y = -lat) so they land on the same dots the pins do.
 */
const MAP_ROUTES = [
  "M104.7 3 Q104.2 4.9 106.8 6.2",
  "M106.8 6.2 Q113 3.4 119.4 5.1",
  "M119.4 5.1 Q128 2 136.9 4.5",
];

const NETWORK_FEATURES = [
  {
    icon: Globe2,
    title: "Coordinate everywhere",
    body: "Branch networks, partner beneficiaries, and donors on one shared allocation layer instead of four inboxes.",
  },
  {
    icon: MapPin,
    title: "Route by what spoils first",
    body: "Proximity, fairness, and spoilage risk are scored together, so the food that can’t wait moves first.",
  },
  {
    icon: ShieldCheck,
    title: "Prove every hand-off",
    body: "Collected, delivered, or recycled — the outcome is recorded. No more capacity guesswork.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="lp-eyebrow">{children}</div>;
}

export default function LandingPage() {
  return (
    <div className="lp">
      {/* ── The moving field every glass surface blurs ──────────────────── */}
      <div className="lp-field" aria-hidden="true">
        <div className="lp-wave lp-wave--soft">
          <div className="lp-wave-shape" />
        </div>
        <div className="lp-grain" />
      </div>

      {/* Dotted page-edge rails, in the manner of a technical drawing */}
      <div className="lp-rail lp-rail--l" aria-hidden="true" />
      <div className="lp-rail lp-rail--r" aria-hidden="true" />

      <div className="lp-above">
        {/* ── Nav — glass, blurred ──────────────────────────────────────── */}
        <header className="lp-nav">
          <div className="lp-shell">
            <span className="lp-wordmark">Lumbung</span>

            <nav className="lp-nav-links">
              {[
                ["Problem", "#problem"],
                ["How it works", "#how"],
                ["Network", "#network"],
                ["Product", "#product"],
                ["Roadmap", "#roadmap"],
              ].map(([label, href]) => (
                <a key={href} href={href} className="lp-nav-link">
                  {label}
                </a>
              ))}
            </nav>

            <Link href="/orchestrator" className="lp-btn lp-btn-solid">
              Live product
              <ArrowRight size={14} />
            </Link>
          </div>
        </header>

        <main>
          {/* ── Hero — type only, one full screen ──────────────────────── */}
          <section className="lp-hero">
            <div className="lp-hero-bloom" aria-hidden="true">
              <div className="lp-wave">
                <div className="lp-wave-shape" />
              </div>
              <div className="lp-grain" />
            </div>

            <div className="lp-shell lp-hero-content">
              <Reveal>
                <h1 className="lp-hero-title">
                  The coordination layer Indonesia&apos;s food banks don&apos;t
                  have yet.
                </h1>
                <p className="lp-hero-meta">
                  Indonesian food redistribution<span>✦</span>Six AI agents
                  <span>✦</span>A human approves every allocation
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Link href="/orchestrator" className="lp-btn lp-btn-solid">
                    See the working system
                    <ArrowRight size={14} />
                  </Link>
                  <a href="#how" className="lp-btn lp-btn-ghost">
                    How it works
                  </a>
                </div>
              </Reveal>
            </div>

            <a href="#problem" className="lp-scroll-cue">
              Scroll
              <ArrowDown size={12} />
            </a>
          </section>

          {/* Ticker — the tools this replaces, on loop */}
          <div className="lp-marquee-band">
            <div className="lp-marquee-track">
              {[...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS].map(
                (t, i) => (
                  <span key={i} className="lp-dot">
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>

          {/* ── One continuous page from here down ─────────────────────── */}
          <div className="lp-body">
            {/* Problem */}
            <section
              id="problem"
              className="lp-block lp-shell"
              style={{ borderTop: "none" }}
            >
              <Reveal>
                <Eyebrow>The problem</Eyebrow>
                <h2 className="lp-h2 lp-measure">
                  Not a generosity problem. A coordination problem.
                </h2>
                <p className="lp-lede">
                  The food exists and the need exists, often in the same city on
                  the same day. What&apos;s missing is the layer that decides
                  which surplus goes where, at what time, against which spoilage
                  clock.
                </p>
              </Reveal>

              <div className="lp-grid-4" style={{ marginTop: 40 }}>
                {PROBLEM_STATS.map((s, i) => (
                  <Reveal key={s.label} delay={i * 70}>
                    <div
                      className="lp-card lp-card--lift"
                      style={{ height: "100%" }}
                    >
                      <div className="lp-stat-num">
                        {s.value != null ? (
                          <CountUp
                            to={s.value}
                            decimals={s.decimals}
                            suffix={s.suffix}
                          />
                        ) : (
                          s.display
                        )}
                      </div>
                      <div
                        className="text-caption lp-card-sub"
                        style={{ margin: "4px 0 10px" }}
                      >
                        {s.unit}
                      </div>
                      <div className="text-caption" style={{ fontWeight: 500 }}>
                        {s.label}
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>

              <Reveal delay={80}>
                <div
                  className="lp-card"
                  style={{ marginTop: 18, padding: "26px 28px 10px" }}
                >
                  <div
                    className="lp-row"
                    style={{
                      justifyContent: "space-between",
                      marginBottom: 18,
                    }}
                  >
                    <div>
                      <div className="text-title-1" style={{ fontWeight: 600 }}>
                        What the sector coordinates with today
                      </div>
                      <p
                        className="text-caption lp-card-sub"
                        style={{ margin: "4px 0 0" }}
                      >
                        Every organisation below is real, operating, and doing
                        serious work — on generic tooling never designed for
                        spoilage-aware allocation.
                      </p>
                    </div>
                    <span className="lp-tag">4 organisations</span>
                  </div>

                  {INCUMBENT_TOOLING.map((row) => (
                    <div
                      key={row.org}
                      className="lp-row"
                      style={{
                        justifyContent: "space-between",
                        padding: "15px 0",
                        borderTop: "1px solid var(--hair-soft)",
                      }}
                    >
                      <div>
                        <div
                          className="text-title-2"
                          style={{ fontWeight: 600 }}
                        >
                          {row.org}
                        </div>
                        <div className="text-caption lp-card-sub">
                          {row.scale}
                        </div>
                      </div>
                      <span className="lp-tag">{row.tooling}</span>
                    </div>
                  ))}
                </div>
              </Reveal>
            </section>

            {/* How it works */}
            <section id="how" className="lp-block lp-shell">
              <Reveal>
                <Eyebrow>How it works</Eyebrow>
                <h2 className="lp-h2 lp-measure">
                  Six agents. One human gate. Zero black boxes.
                </h2>
                <p className="lp-lede">
                  Every agent calls real tools reading real data — proximity,
                  spare capacity, spoilage risk, fleet availability. It
                  can&apos;t invent a number; it can only decide whether to act
                  on the real one it was handed.
                </p>
              </Reveal>

              <div className="lp-grid-3" style={{ marginTop: 38 }}>
                {PIPELINE.map((s, i) => (
                  <Reveal key={s.step} delay={i * 60}>
                    <div
                      className="lp-card lp-card--lift"
                      style={{ height: "100%" }}
                    >
                      <div className="lp-step-num">{s.step}</div>
                      <div
                        className="text-title-1"
                        style={{ fontWeight: 600, margin: "10px 0 6px" }}
                      >
                        {s.title}
                      </div>
                      <p
                        className="text-caption lp-card-sub"
                        style={{ margin: 0 }}
                      >
                        {s.body}
                      </p>
                    </div>
                  </Reveal>
                ))}

                <Reveal delay={360}>
                  <div
                    className="lp-card lp-card--ink"
                    style={{ height: "100%" }}
                  >
                    <ShieldCheck size={18} style={{ opacity: 0.8 }} />
                    <div
                      className="text-title-1"
                      style={{
                        fontWeight: 600,
                        margin: "10px 0 6px",
                        color: "#fff",
                      }}
                    >
                      The AI can stop something. It can never start something.
                    </div>
                    <p className="text-caption" style={{ margin: 0 }}>
                      It blocks unsafe submissions on its own. It only ever
                      recommends an allocation — no allocation is
                      auto-committed. Full stop.
                    </p>
                  </div>
                </Reveal>
              </div>
            </section>

            {/* Network — the dotted map */}
            <section id="network" className="lp-block lp-shell">
              <Reveal>
                <div style={{ textAlign: "center" }}>
                  <Eyebrow>The network</Eyebrow>
                  <h2
                    className="lp-h2"
                    style={{ maxWidth: 620, margin: "12px auto 14px" }}
                  >
                    Region: Indonesia
                  </h2>
                  <p className="lp-lede" style={{ margin: "0 auto" }}>
                    One coordination layer across the archipelago — close to the
                    surplus, close to the need.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={100}>
                <div className="lp-map">
                  <div className="lp-map-canvas">
                    {/* `unoptimized` because the Next image optimizer refuses
                      SVG unless dangerouslyAllowSVG is set; this file is our
                      own generated asset, served as-is. */}
                    <Image
                      src="/indonesia-dots.svg"
                      alt="Dotted map of the Indonesian archipelago"
                      width={1400}
                      height={540}
                      unoptimized
                      priority
                    />

                    <svg
                      className="lp-map-routes"
                      viewBox="94.5 -6.5 47 18"
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                    >
                      {MAP_ROUTES.map((d) => (
                        <path key={d} d={d} />
                      ))}
                    </svg>

                    {MAP_NODES.map((n) => {
                      const Icon = n.icon;
                      return (
                        <div
                          key={n.label}
                          className={`lp-map-node${n.ink ? " lp-map-node--ink" : ""}${n.delay ? " lp-map-node--delay" : ""}`}
                          style={{ top: `${n.y}%`, left: `${n.x}%` }}
                          title={n.label}
                        >
                          <Icon size={18} />
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="lp-frame lp-map-label"
                    style={{ top: "12%", right: 0 }}
                  >
                    Every donation is matched against real distance, real spare
                    capacity, and the spoilage clock on the food itself — then
                    held for a person to approve.
                  </div>
                </div>
              </Reveal>

              {/* Outlined feature row */}
              <Reveal delay={140}>
                <div
                  className="lp-outline-row lp-grid-3"
                  style={{ marginTop: 40, gap: 0 }}
                >
                  {NETWORK_FEATURES.map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.title} className="lp-outline-col">
                        <Icon
                          size={22}
                          className="lp-outline-icon"
                          strokeWidth={1.5}
                        />
                        <div
                          className="text-title-1"
                          style={{ fontWeight: 600, marginBottom: 6 }}
                        >
                          {c.title}
                        </div>
                        <p
                          className="text-caption lp-card-sub"
                          style={{ margin: 0, maxWidth: 320 }}
                        >
                          {c.body}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </Reveal>
            </section>

            {/* Product screenshots */}
            <section id="product" className="lp-block lp-shell">
              <Reveal>
                <Eyebrow>The product</Eyebrow>
                <h2 className="lp-h2 lp-measure">
                  Not a mockup. The system, running.
                </h2>
                <p className="lp-lede">
                  Live operations, the donor submission flow, and the agent
                  pipeline — every screen below is the working product, not a
                  render.
                </p>
              </Reveal>

              <Reveal delay={100}>
                <div className="lp-shots">
                  {SHOTS.map((s) => (
                    <div key={s.src} className="lp-shot">
                      <div className="lp-shot-bar" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <Image src={s.src} alt={s.cap} width={s.w} height={s.h} />
                      <div className="lp-shot-cap">{s.cap}</div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </section>

            {/* Why now */}
            <section className="lp-block lp-shell">
              <div className="lp-split">
                <Reveal>
                  <div>
                    <Eyebrow>Why now</Eyebrow>
                    <h2 className="lp-h2" style={{ maxWidth: 520 }}>
                      The audit trail becomes a legal requirement in 2027.
                    </h2>
                    <p className="lp-lede">
                      Indonesia&apos;s OJK ratified Sustainability Disclosure
                      Standards (PSPK 1/2) in July 2025, requiring quantitative
                      waste disclosures from January 2027. Lumbung produces that
                      record as a byproduct of normal operations — the charity
                      gets coordination it can&apos;t buy today; the corporate
                      donor gets the number their auditor is about to require.
                    </p>
                  </div>
                </Reveal>

                <Reveal delay={100}>
                  <div
                    className="lp-card"
                    style={{ padding: "24px 26px 12px" }}
                  >
                    <Eyebrow>OJK PSPK phase-in</Eyebrow>
                    <div style={{ marginTop: 14 }}>
                      {OJK_PHASES.map((g, i) => (
                        <div
                          key={g.group}
                          style={{
                            padding: "13px 0",
                            borderTop:
                              i === 0 ? "none" : "1px solid var(--hair-soft)",
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span
                              className="text-title-2"
                              style={{ fontWeight: 600 }}
                            >
                              {g.group}{" "}
                              <span className="tnum lp-card-sub">
                                · {g.from}
                              </span>
                            </span>
                            {g.active && (
                              <span className="lp-tag lp-tag--ink">Next</span>
                            )}
                          </div>
                          <div className="text-caption lp-card-sub">
                            {g.who}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Reveal>
              </div>
            </section>

            {/* Status */}
            <section className="lp-block lp-shell">
              <Reveal>
                <Eyebrow>Status</Eyebrow>
                <h2 className="lp-h2 lp-measure">
                  A working system, and an honest list of what it isn&apos;t
                  yet.
                </h2>
              </Reveal>

              <div className="lp-grid-2" style={{ marginTop: 34 }}>
                <Reveal>
                  <div className="lp-card" style={{ height: "100%" }}>
                    <span className="lp-tag lp-tag--ink">
                      Built and running
                    </span>
                    <div style={{ marginTop: 16 }}>
                      {BUILT.map((b) => (
                        <div key={b} className="lp-bullet">
                          <ShieldCheck
                            size={14}
                            style={{
                              marginTop: 2,
                              flexShrink: 0,
                              opacity: 0.45,
                            }}
                          />
                          <span className="text-caption">{b}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Reveal>

                <Reveal delay={90}>
                  <div className="lp-card" style={{ height: "100%" }}>
                    <span className="lp-tag">
                      Required for Indonesia — not built yet
                    </span>
                    <div style={{ marginTop: 16 }}>
                      {NEXT.map((n) => (
                        <div key={n.label} className="lp-bullet">
                          <span
                            className="lp-step-num"
                            style={{
                              marginTop: 2,
                              flexShrink: 0,
                              width: 20,
                              fontSize: 10.5,
                            }}
                          >
                            {n.priority}
                          </span>
                          <span className="text-caption">{n.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Reveal>
              </div>

              <div className="lp-grid-2" style={{ marginTop: 18 }}>
                <Reveal>
                  <div
                    className="lp-card lp-card--lift"
                    style={{ height: "100%" }}
                  >
                    <div
                      className="text-title-1"
                      style={{ fontWeight: 600, marginBottom: 6 }}
                    >
                      &ldquo;I don&apos;t have time for another app&rdquo;
                    </div>
                    <p
                      className="text-caption lp-card-sub"
                      style={{ margin: 0 }}
                    >
                      Answered with a WhatsApp-first donor flow: one message and
                      a photo, parsed into a listing. No install, no account, no
                      login during a busy service.
                    </p>
                  </div>
                </Reveal>

                <Reveal delay={90}>
                  <div
                    className="lp-card lp-card--lift"
                    style={{ height: "100%" }}
                  >
                    <div
                      className="text-title-1"
                      style={{ fontWeight: 600, marginBottom: 6 }}
                    >
                      &ldquo;I&apos;m worried about liability&rdquo;
                    </div>
                    <p
                      className="text-caption lp-card-sub"
                      style={{ margin: 0 }}
                    >
                      Answered by surfacing the legal protections that apply to
                      food donors at the moment of donation, rather than leaving
                      them to guess at their exposure.
                    </p>
                  </div>
                </Reveal>
              </div>
            </section>

            {/* Roadmap */}
            <section id="roadmap" className="lp-block lp-shell">
              <Reveal>
                <Eyebrow>Roadmap</Eyebrow>
                <h2 className="lp-h2 lp-measure">
                  Earn the case study, then sell the proof.
                </h2>
                <p className="lp-lede">
                  Partner-first, not customer-first. A cold pitch to a food bank
                  in Month 1 fails; a quiet pilot that produces a testimonial in
                  Month 3 opens every door after it.
                </p>
              </Reveal>

              <div className="flex flex-col gap-3" style={{ marginTop: 34 }}>
                {PHASES.map((p, i) => (
                  <Reveal key={p.phase} delay={i * 70}>
                    <div
                      className="lp-card lp-card--lift lp-row"
                      style={{ justifyContent: "space-between" }}
                    >
                      <div style={{ flex: "0 0 150px" }}>
                        <div className="lp-step-num">
                          {p.phase.toUpperCase()}
                        </div>
                        <div className="text-caption lp-card-sub tnum">
                          {p.window}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="text-title-1"
                          style={{ fontWeight: 600, marginBottom: 4 }}
                        >
                          {p.title}
                        </div>
                        <p
                          className="text-caption lp-card-sub"
                          style={{ margin: 0 }}
                        >
                          {p.body}
                        </p>
                      </div>
                      <div style={{ flex: "0 0 180px" }}>
                        <span className="lp-tag tnum">{p.revenue}</span>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </section>

            {/* Closing CTA */}
            <section className="lp-shell">
              <Reveal>
                <div className="lp-cta">
                  <Eyebrow>Lumbung</Eyebrow>
                  <h2 className="lp-h2">The system is live. Go use it.</h2>
                  <p className="lp-lede">
                    Submit a donation and watch it get safety-checked, routed,
                    approved, planned and dispatched — with every agent&apos;s
                    reasoning visible at each step.
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <Link href="/donate" className="lp-btn lp-btn-solid">
                      Submit a donation
                      <ArrowRight size={14} />
                    </Link>
                    <Link href="/orchestrator" className="lp-btn lp-btn-ghost">
                      Open the operations view
                    </Link>
                  </div>
                </div>
              </Reveal>
            </section>
          </div>
        </main>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="lp-footer">
          <div className="lp-shell flex items-center justify-between gap-4 flex-wrap">
            <span>
              Lumbung — a coordination layer for Indonesian food redistribution
            </span>
            <div className="flex items-center gap-6">
              <Link href="/recipient" className="lp-nav-link">
                Browse food
              </Link>
              <Link href="/donate" className="lp-nav-link">
                Donate
              </Link>
              <Link href="/orchestrator" className="lp-nav-link">
                Operations
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
