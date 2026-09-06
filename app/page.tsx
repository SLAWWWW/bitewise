import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '@/components/landing/Reveal';
import { CountUp } from '@/components/landing/CountUp';

/**
 * Lumbung's public landing page — the pitch surface.
 *
 * Deliberately its own visual register from the product it sits in front
 * of: monochrome brutalism × minimalism rather than the product's editorial
 * light system. Pure black and white, hard edges, heavy type, thick rules —
 * Apple's typographic discipline (SF system font, precise scale, restraint)
 * applied to a raw structural language instead of Apple's usual softness.
 * Motion (scroll-reveal, count-up stats, a marquee ticker) supplies the
 * "dynamic" energy colour would otherwise carry.
 *
 * The hero collage uses real screenshots of the live product
 * (public/screenshots/*.png), desaturated to grayscale, so the monochrome
 * constraint applies to the proof, not just the marketing copy around it.
 */

// ── Section 1: the scale of the problem ─────────────────────────────────────
const PROBLEM_STATS = [
  { value: null, display: '23–48M', unit: 'tonnes', label: 'Food wasted in Indonesia every year', source: 'UNEP Food Waste Index, Bappenas' },
  { value: null, display: '2nd', unit: 'globally', label: 'Largest food waster in the world', source: 'UNEP' },
  { value: 23.36, decimals: 2, unit: 'million people', label: 'Living below the national poverty line', source: 'BPS, Sep 2025', suffix: 'M' },
  { value: 21, decimals: 0, unit: 'of under-5s', label: 'Indonesian children affected by stunting', source: 'Indonesian health statistics', suffix: '%' },
];

// ── Section 2: what the sector actually runs on today ───────────────────────
const INCUMBENT_TOOLING = [
  {
    org: 'FoodCycle Indonesia',
    scale: '120+ donor partners · 100+ beneficiary organisations',
    tooling: 'Zoho Creator forms',
    gap: 'No automated matching, no fairness logic, no spoilage-aware routing',
  },
  {
    org: 'Foodbank of Indonesia',
    scale: '39 locations across Java · 4,454 volunteers',
    tooling: 'Phone and WhatsApp',
    gap: 'No documented allocation logic across 39 locations',
  },
  {
    org: 'Garda Pangan',
    scale: '113 tonnes over 5 years · Surabaya + Malang',
    tooling: 'Basic app, low adoption',
    gap: 'Academically characterised as a "traditional consumptive model" — reactive, not coordinated',
  },
  {
    org: 'Foodbank Bandung',
    scale: 'Regional',
    tooling: 'Microsoft Excel',
    gap: 'Documented limits in multi-user interaction and data management',
  },
];

// ── Section 3: the pipeline ─────────────────────────────────────────────────
const PIPELINE = [
  {
    step: '01',
    title: 'Safety floor',
    body: 'Every submission is scored against a standardised food-safety corpus before a listing exists. A deterministic floor decides the verdict; the AI may only make it stricter, never softer.',
  },
  {
    step: '02',
    title: 'Fairness-weighted matching',
    body: 'Each candidate branch is scored on real proximity, real spare capacity relative to its own size, and whether it already holds a glut of the same food type about to spoil.',
  },
  {
    step: '03',
    title: 'Human approval gate',
    body: 'Nothing reaches a branch automatically. Every allocation waits in a queue sorted by what spoils soonest until a staff member approves it. The AI recommends; a person decides.',
  },
  {
    step: '04',
    title: 'Planned and dispatched',
    body: 'A planner agent builds the stage-by-stage journey against real fleet and storage constraints. Critical stock dispatches the moment it is committed, not on a batch timer.',
  },
  {
    step: '05',
    title: 'Closed loop',
    body: 'Collected, delivered to a partner, or recycled — every donation ends in a recorded outcome, not an open row. That record is the audit trail the compliance product is built on.',
  },
];

// ── Section 6: build status, stated honestly ────────────────────────────────
const BUILT = [
  'Six specialised agents with real function-calling tool use',
  'Deterministic safety floor with AI escalate-only override',
  'Fairness-weighted branch matching (Jain’s Fairness Index)',
  'Human approval gate on every allocation',
  'Demand-quota allocation to partner beneficiaries',
  'Immediate dispatch for time-critical stock',
  'Live operations dashboard, storage, fleet and audit log',
  'Deterministic fallback on every agent — nothing blocks if AI is down',
];

const NEXT = [
  { label: 'Bahasa Indonesia across every surface', priority: 'P0' },
  { label: 'WhatsApp-first donor submission with photo parsing', priority: 'P0' },
  { label: 'Indonesian donor legal protections surfaced at submission', priority: 'P0' },
  { label: 'Real authentication with role separation', priority: 'P0' },
  { label: 'Multi-organisation tenancy', priority: 'P1' },
  { label: 'Structured allergen declaration', priority: 'P1' },
  { label: 'Volunteer coordination module', priority: 'P1' },
  { label: 'Corporate ESG compliance dashboard and export', priority: 'P2' },
];

// ── Section 7: roadmap ──────────────────────────────────────────────────────
const PHASES = [
  {
    phase: 'Phase 1',
    window: 'Month 1–3',
    title: 'Free pilot',
    body: 'Embed inside one respected Indonesian food-rescue organisation. Prove reduced spoilage and reclaimed staff time. Ask only for the case study.',
    revenue: 'Rp 0 — pure validation',
  },
  {
    phase: 'Phase 2',
    window: 'Month 4–8',
    title: 'Monetise the charity side',
    body: 'Convert the pilot to subscription, expand to a 39-location network where fairness-weighted matching genuinely earns its keep.',
    revenue: 'Rp 500K–1.5M / month per org',
  },
  {
    phase: 'Phase 3',
    window: 'Month 6–12',
    title: 'Corporate compliance',
    body: 'Sell the audit trail to the corporate donors already flowing through the platform, introduced warmly by the charities themselves.',
    revenue: 'Rp 5M–40M / month per customer',
  },
  {
    phase: 'Phase 4',
    window: 'Month 12–18',
    title: 'Deep moat',
    body: 'Verified cold chain, tamper-evident audit anchoring, and shared routing intelligence across partner organisations.',
    revenue: 'Network and international expansion',
  },
];

const TICKER_ITEMS = ['ZOHO CREATOR FORMS', 'MICROSOFT EXCEL', 'PHONE & WHATSAPP', 'BASIC APP, LOW ADOPTION'];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="lp-eyebrow">{children}</div>;
}

export default function LandingPage() {
  return (
    <div className="lp">
      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <header className="lp-nav">
        <div className="lp-shell flex items-center justify-between gap-3" style={{ padding: '18px 0' }}>
          <span className="lp-wordmark">Lumbung</span>

          <nav className="lp-nav-links">
            {[
              ['Problem', '#problem'],
              ['How it works', '#how'],
              ['Boundary', '#boundary'],
              ['Roadmap', '#roadmap'],
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
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-shell">
            <Reveal>
              <span className="lp-tag">Indonesia · food redistribution infrastructure</span>
              <h1 className="lp-hero-title">
                The coordination
                <br />
                layer Indonesia&apos;s
                <br />
                food banks don&apos;t
                <br />
                have yet.
              </h1>
              <p className="lp-hero-lede">
                Indonesia is the world&apos;s second-largest food waster while 23 million of its people live below the
                poverty line. Four serious food-rescue organisations already operate at scale — and every one of them
                coordinates through Zoho forms, Excel, or WhatsApp. Lumbung is the software layer between surplus and
                need: six AI agents that route, plan, and prove every donation, with a human approving every
                allocation.
              </p>
              <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 30 }}>
                <Link href="/orchestrator" className="lp-btn lp-btn-solid">
                  See the working system
                  <ArrowRight size={15} />
                </Link>
                <a href="#how" className="lp-btn lp-btn-outline">
                  How it works
                </a>
              </div>
            </Reveal>
          </div>

          {/* Screenshot collage — real product, desaturated, fading to white */}
          <Reveal delay={120}>
            <div className="lp-collage" aria-hidden="true">
              <div className="lp-collage-edge lp-collage-edge--left" />
              <div className="lp-collage-edge lp-collage-edge--right" />

              <div className="lp-frame lp-frame--left">
                <div className="lp-frame-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <Image src="/screenshots/agents.png" alt="" width={1370} height={340} />
              </div>

              <div className="lp-frame lp-frame--center">
                <div className="lp-frame-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <Image src="/screenshots/dashboard.png" alt="" width={1370} height={560} priority />
              </div>

              <div className="lp-frame lp-frame--right">
                <div className="lp-frame-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <Image src="/screenshots/donate.png" alt="" width={1600} height={900} />
              </div>
            </div>
          </Reveal>
        </section>

        {/* Ticker — the tools it replaces, stated flatly, on loop */}
        <div className="lp-marquee-band">
          <div className="lp-marquee-track">
            {[...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS].map((t, i) => (
              <span key={i} className="lp-dot">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* ── Problem ──────────────────────────────────────────────────── */}
        <section id="problem" className="lp-section">
          <div className="lp-shell">
            <Reveal>
              <SectionLabel>The problem</SectionLabel>
              <h2 className="lp-h2 lp-measure">Not a generosity problem. A coordination problem.</h2>
              <p className="lp-lede">
                The food exists and the need exists, often in the same city on the same day. What&apos;s missing is
                the layer that decides which surplus goes to which branch, at what time, against which spoilage
                clock.
              </p>
            </Reveal>

            <div className="grid-stats" style={{ marginTop: 44, marginBottom: 48 }}>
              {PROBLEM_STATS.map((s, i) => (
                <Reveal key={s.label} delay={i * 70}>
                  <div className="lp-card lp-card--hover" style={{ height: '100%' }}>
                    <div className="lp-stat-num">
                      {s.value != null ? (
                        <CountUp to={s.value} decimals={s.decimals} suffix={s.suffix} />
                      ) : (
                        s.display
                      )}
                    </div>
                    <div className="text-caption lp-card-sub" style={{ marginBottom: 12, marginTop: 2 }}>
                      {s.unit}
                    </div>
                    <div className="text-caption" style={{ fontWeight: 600, marginBottom: 8 }}>
                      {s.label}
                    </div>
                    <div className="text-caption lp-card-sub" style={{ fontSize: 10.5 }}>
                      {s.source}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal>
              <div className="lp-card" style={{ padding: '30px 28px 16px' }}>
                <h3 className="text-title-1" style={{ marginBottom: 6, fontWeight: 800 }}>
                  What the sector coordinates with today
                </h3>
                <p className="lp-lede" style={{ marginBottom: 26 }}>
                  Every organisation below is real, operating, and doing serious work — on generic tooling never
                  designed for spoilage-aware allocation across a branch network.
                </p>

                <div className="flex flex-col">
                  {INCUMBENT_TOOLING.map((row, i) => (
                    <div
                      key={row.org}
                      className="lp-row"
                      style={{ padding: '18px 0', borderTop: i === 0 ? 'none' : '2px solid #000' }}
                    >
                      <div style={{ flex: '0 0 210px' }}>
                        <div className="text-title-2" style={{ fontWeight: 700 }}>
                          {row.org}
                        </div>
                        <div className="text-caption lp-card-sub" style={{ fontSize: 11.5 }}>
                          {row.scale}
                        </div>
                      </div>
                      <div style={{ flex: '0 0 200px' }}>
                        <span className="lp-tag">{row.tooling}</span>
                      </div>
                      <div className="text-caption" style={{ flex: 1, minWidth: 0 }}>
                        {row.gap}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── How it works (inverted) ──────────────────────────────────── */}
        <section id="how" className="lp-section lp-section-invert">
          <div className="lp-shell">
            <Reveal>
              <SectionLabel>How it works</SectionLabel>
              <h2 className="lp-h2 lp-measure">Six agents. One human gate. Zero black boxes.</h2>
              <p className="lp-lede">
                Every agent calls real tools that read real data — proximity, spare capacity, spoilage risk, fleet
                availability, storage headroom. The model can&apos;t invent a number; it can only decide whether to
                act on the real one it was handed. Every call it makes is recorded and inspectable after the fact.
              </p>
            </Reveal>

            <div className="flex flex-col gap-3" style={{ marginTop: 40 }}>
              {PIPELINE.map((s, i) => (
                <Reveal key={s.step} delay={i * 70}>
                  <div className="lp-card lp-card--hover flex items-start gap-5" style={{ padding: '26px 26px' }}>
                    <span className="lp-stat-num" style={{ fontSize: 34, flexShrink: 0 }}>
                      {s.step}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="text-title-1" style={{ marginBottom: 6, fontWeight: 800 }}>
                        {s.title}
                      </div>
                      <p className="text-caption lp-card-sub" style={{ margin: 0, maxWidth: 720, fontSize: 13 }}>
                        {s.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── AI/human boundary ────────────────────────────────────────── */}
        <section id="boundary" className="lp-section">
          <div className="lp-shell">
            <Reveal>
              <SectionLabel>The AI / human boundary</SectionLabel>
              <h2 className="lp-h2 lp-measure">The AI can stop something. It can never start something.</h2>
              <p className="lp-lede">
                Most &ldquo;AI for good&rdquo; products are vague about where the model&apos;s authority ends.
                Lumbung is specific, and the boundary is enforced in code rather than promised in policy.
              </p>
            </Reveal>

            <div className="grid-thirds" style={{ marginTop: 40 }}>
              <Reveal delay={0}>
                <div className="lp-card lp-card--solid" style={{ height: '100%' }}>
                  <div className="lp-tag lp-tag--solid" style={{ marginBottom: 16 }}>
                    The AI decides alone
                  </div>
                  <p className="text-body" style={{ color: '#fff', fontSize: 14, marginBottom: 10 }}>
                    Blocking a submission that fails the food-safety floor.
                  </p>
                  <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                    Bounded by a deterministic calculation it can escalate but never talk its way under.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={70}>
                <div className="lp-card lp-card--hover" style={{ height: '100%' }}>
                  <div className="lp-tag" style={{ marginBottom: 16 }}>
                    The AI advises
                  </div>
                  <p className="text-body" style={{ color: 'inherit', fontSize: 14, marginBottom: 10 }}>
                    Which branch, which partner, what route, what timing.
                  </p>
                  <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                    Every recommendation carries its own reasoning and the tool calls behind it.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={140}>
                <div className="lp-card lp-card--double" style={{ height: '100%' }}>
                  <div className="lp-tag" style={{ marginBottom: 16 }}>
                    A human decides
                  </div>
                  <p className="text-body" style={{ color: 'inherit', fontSize: 14, marginBottom: 10 }}>
                    Every allocation, every pickup confirmation, every delivery.
                  </p>
                  <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                    No allocation is ever auto-committed. Full stop.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Regulatory tailwind ──────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-shell">
            <SectionLabel>Why now</SectionLabel>
            <div className="lp-row" style={{ alignItems: 'flex-start', gap: 40 }}>
              <Reveal>
                <div style={{ maxWidth: 600 }}>
                  <h2 className="lp-h2" style={{ maxWidth: 560 }}>
                    The audit trail becomes a legal requirement in 2027.
                  </h2>
                  <p className="lp-lede" style={{ marginBottom: 18 }}>
                    Indonesia&apos;s OJK ratified national Sustainability Disclosure Standards (PSPK 1 and 2) in July
                    2025, aligned with IFRS S1/S2. PSPK 2 requires quantitative climate disclosures including waste
                    indicators — precisely the data category that food-waste diversion tracking produces.
                  </p>
                  <p className="lp-lede" style={{ margin: 0 }}>
                    Lumbung generates that record as a byproduct of normal operations. The charity gets coordination
                    it can&apos;t currently buy; the corporate donor gets the defensible number their auditor is about
                    to ask for. Same data, two customers.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={100}>
                <div className="lp-card" style={{ padding: '24px 24px 8px', flex: '0 0 380px' }}>
                  <div className="lp-eyebrow" style={{ marginBottom: 16, fontSize: 11 }}>
                    OJK PSPK phase-in
                  </div>
                  {[
                    { group: 'Group 1', who: 'Main-board issuers, major banks', from: 'Jan 2027', active: true },
                    { group: 'Group 2', who: 'Development-board issuers', from: 'Jan 2028', active: false },
                    { group: 'Group 3', who: 'Asset managers, public-interest entities', from: 'Jan 2029', active: false },
                  ].map((g, i) => (
                    <div key={g.group} style={{ padding: '16px 0', borderTop: i === 0 ? 'none' : '2px solid #000' }}>
                      <div className="text-title-2" style={{ fontSize: 14, fontWeight: 700 }}>
                        {g.group} <span className="tnum">· {g.from}</span>
                        {g.active && <span className="lp-tag lp-tag--solid" style={{ marginLeft: 8, fontSize: 9 }}>Next</span>}
                      </div>
                      <div className="text-caption lp-card-sub" style={{ fontSize: 11.5 }}>
                        {g.who}
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Build status ─────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-shell">
            <Reveal>
              <SectionLabel>Status</SectionLabel>
              <h2 className="lp-h2 lp-measure">A working system, and an honest list of what it isn&apos;t yet.</h2>
              <p className="lp-lede">
                The coordination engine is built and running, not a prototype rendered for a deck. What it still
                needs for the Indonesian market is named below rather than glossed over.
              </p>
            </Reveal>

            <div className="grid-halves" style={{ marginTop: 40 }}>
              <Reveal delay={0}>
                <div className="lp-card" style={{ height: '100%' }}>
                  <div className="lp-tag lp-tag--solid" style={{ marginBottom: 18 }}>
                    Built and running
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {BUILT.map((b) => (
                      <div key={b} className="flex items-start gap-2.5">
                        <span style={{ fontWeight: 800, flexShrink: 0 }}>—</span>
                        <span className="text-caption">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal delay={90}>
                <div className="lp-card" style={{ height: '100%' }}>
                  <div className="lp-tag" style={{ marginBottom: 18 }}>
                    Required for Indonesia — not built yet
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {NEXT.map((n) => (
                      <div key={n.label} className="flex items-start gap-2.5">
                        <span className="lp-tag" style={{ fontSize: 9.5, padding: '1px 7px', marginTop: 1, flexShrink: 0 }}>
                          {n.priority}
                        </span>
                        <span className="text-caption">{n.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>

            <div className="grid-halves" style={{ marginTop: 14 }}>
              <Reveal delay={0}>
                <div className="lp-card lp-card--hover" style={{ height: '100%' }}>
                  <div className="text-title-2" style={{ marginBottom: 6, fontWeight: 800 }}>
                    &ldquo;I don&apos;t have time for another app&rdquo;
                  </div>
                  <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                    Answered with a WhatsApp-first donor flow: one message and a photo, parsed into a structured
                    listing. No install, no account, no login during a busy service.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={90}>
                <div className="lp-card lp-card--hover" style={{ height: '100%' }}>
                  <div className="text-title-2" style={{ marginBottom: 6, fontWeight: 800 }}>
                    &ldquo;I&apos;m worried about liability&rdquo;
                  </div>
                  <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                    Answered by surfacing the legal protections that apply to food donors at the moment of donation,
                    rather than leaving the donor to guess at their exposure.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Roadmap (inverted) ────────────────────────────────────────── */}
        <section id="roadmap" className="lp-section lp-section-invert">
          <div className="lp-shell">
            <Reveal>
              <SectionLabel>Roadmap</SectionLabel>
              <h2 className="lp-h2 lp-measure">Earn the case study, then sell the proof.</h2>
              <p className="lp-lede">
                Partner-first, not customer-first. A cold pitch to a food bank in Month 1 fails; a quiet pilot that
                produces a testimonial in Month 3 opens every door after it.
              </p>
            </Reveal>

            <div className="flex flex-col gap-3" style={{ marginTop: 40 }}>
              {PHASES.map((p, i) => (
                <Reveal key={p.phase} delay={i * 70}>
                  <div className="lp-card lp-card--hover lp-row lp-row-center" style={{ padding: '26px 26px' }}>
                    <div style={{ flex: '0 0 132px' }}>
                      <div className="lp-eyebrow" style={{ fontSize: 11 }}>
                        {p.phase}
                      </div>
                      <div className="text-caption lp-card-sub tnum" style={{ fontSize: 11.5 }}>
                        {p.window}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-title-2" style={{ marginBottom: 4, fontWeight: 800 }}>
                        {p.title}
                      </div>
                      <p className="text-caption lp-card-sub" style={{ margin: 0 }}>
                        {p.body}
                      </p>
                    </div>
                    <div style={{ flex: '0 0 190px' }}>
                      <span className="text-caption tnum" style={{ fontWeight: 700 }}>
                        {p.revenue}
                      </span>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <section className="lp-invert" style={{ background: '#000', padding: '96px 0', textAlign: 'center' }}>
          <div className="lp-shell">
            <Reveal>
              <div className="lp-wordmark" style={{ fontSize: 15, color: '#fff', marginBottom: 22 }}>
                Lumbung
              </div>
              <h2 className="lp-h2" style={{ color: '#fff', maxWidth: 600, margin: '0 auto 16px' }}>
                The system is live. Go use it.
              </h2>
              <p className="lp-lede" style={{ color: '#c7c7c7', maxWidth: 520, margin: '0 auto 32px' }}>
                Submit a donation and watch it get safety-checked, routed, approved, planned and dispatched — with
                every agent&apos;s reasoning visible at each step.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link href="/donate" className="lp-btn lp-btn-solid">
                  Submit a donation
                  <ArrowRight size={15} />
                </Link>
                <Link href="/orchestrator" className="lp-btn lp-btn-outline">
                  Open the operations view
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '2px solid #000', padding: '26px 0' }}>
        <div className="lp-shell flex items-center justify-between gap-4 flex-wrap">
          <span className="text-caption" style={{ fontWeight: 600 }}>
            LUMBUNG — a coordination layer for Indonesian food redistribution
          </span>
          <div className="flex items-center gap-5">
            <Link href="/recipient" className="lp-nav-link" style={{ fontSize: 11 }}>
              Browse food
            </Link>
            <Link href="/donate" className="lp-nav-link" style={{ fontSize: 11 }}>
              Donate
            </Link>
            <Link href="/orchestrator" className="lp-nav-link" style={{ fontSize: 11 }}>
              Operations
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
