import Link from 'next/link';
import {
  ArrowRight,
  ShieldCheck,
  Scale,
  Route,
  ClipboardCheck,
  Boxes,
  Clock3,
  MessageCircle,
  FileCheck2,
  CircleCheck,
  CircleDashed,
} from 'lucide-react';
import { LumbungMark } from '@/components/brand/LumbungMark';

/**
 * Lumbung's public landing page — the pitch surface.
 *
 * Deliberately built on the same design system as the product it sits in
 * front of (editorial light: warm off-white canvas, flat white cards,
 * near-black type, colour reserved for meaning rather than decoration), so
 * clicking from this page into the live product reads as one continuous
 * thing rather than a marketing site bolted onto a different app.
 *
 * The brand accent is `--branch-1`, the amber already in the palette — it
 * carries the granary/harvest association the name is built on without
 * introducing a colour the design system doesn't already own.
 */

const ACCENT = 'var(--branch-1)';

// ── Section 1: the scale of the problem ─────────────────────────────────────
const PROBLEM_STATS = [
  { value: '23–48M', unit: 'tonnes', label: 'Food wasted in Indonesia every year', source: 'UNEP Food Waste Index, Bappenas' },
  { value: '2nd', unit: 'globally', label: 'Largest food waster in the world', source: 'UNEP' },
  { value: '23.36M', unit: 'people', label: 'Living below the national poverty line', source: 'BPS, Sep 2025' },
  { value: '21%', unit: 'of under-5s', label: 'Indonesian children affected by stunting', source: 'Indonesian health statistics' },
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
    gap: 'Academically characterised as a “traditional consumptive model” — reactive, not coordinated',
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
    icon: ShieldCheck,
    step: '01',
    title: 'Safety floor',
    body: 'Every submission is scored against a standardised food-safety corpus before a listing exists. A deterministic floor decides the verdict; the AI may only make it stricter, never softer.',
  },
  {
    icon: Scale,
    step: '02',
    title: 'Fairness-weighted matching',
    body: 'Each candidate branch is scored on real proximity, real spare capacity relative to its own size, and whether it already holds a glut of the same food type about to spoil.',
  },
  {
    icon: ClipboardCheck,
    step: '03',
    title: 'Human approval gate',
    body: 'Nothing reaches a branch automatically. Every allocation waits in a queue sorted by what spoils soonest until a staff member approves it. The AI recommends; a person decides.',
  },
  {
    icon: Route,
    step: '04',
    title: 'Planned and dispatched',
    body: 'A planner agent builds the stage-by-stage journey against real fleet and storage constraints. Critical stock dispatches the moment it is committed, not on a batch timer.',
  },
  {
    icon: Boxes,
    step: '05',
    title: 'Closed loop',
    body: 'Collected, delivered to a partner, or recycled — every donation ends in a recorded outcome, not an open row. That record is the audit trail the compliance product is built on.',
  },
];

// ── Section 4: the AI/human boundary ────────────────────────────────────────
const BOUNDARY = [
  {
    who: 'The AI decides alone',
    what: 'Blocking a submission that fails the food-safety floor.',
    bound: 'Bounded by a deterministic calculation it can escalate but never talk its way under.',
    tone: 'critical' as const,
  },
  {
    who: 'The AI advises',
    what: 'Which branch, which partner, what route, what timing.',
    bound: 'Every recommendation carries its own reasoning and the tool calls behind it.',
    tone: 'accent' as const,
  },
  {
    who: 'A human decides',
    what: 'Every allocation, every pickup confirmation, every delivery.',
    bound: 'No allocation is ever auto-committed. Full stop.',
    tone: 'success' as const,
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-overline" style={{ marginBottom: 12 }}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between gap-3"
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 30, height: 30, background: ACCENT, color: '#fff' }}
          >
            <LumbungMark size={17} color="#fff" />
          </div>
          <span className="text-title-2" style={{ letterSpacing: '-0.02em' }}>
            Lumbung
          </span>
        </div>

        <nav className="lp-nav-links">
          {[
            ['Problem', '#problem'],
            ['How it works', '#how'],
            ['Boundary', '#boundary'],
            ['Roadmap', '#roadmap'],
          ].map(([label, href]) => (
            <a key={href} href={href} className="text-caption" style={{ color: 'var(--text-secondary)' }}>
              {label}
            </a>
          ))}
        </nav>

        <Link
          href="/orchestrator"
          className="btn btn-primary"
          style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
        >
          <span className="hidden sm:inline">Open the live product</span>
          <span className="sm:hidden">Live product</span>
          <ArrowRight size={14} />
        </Link>
      </header>

      <main className="lp-shell">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div style={{ maxWidth: 780 }}>
            <span
              className="badge"
              style={{
                background: 'rgba(217, 114, 10, 0.09)',
                color: ACCENT,
                border: '1px solid rgba(217, 114, 10, 0.2)',
                marginBottom: 26,
              }}
            >
              Indonesia · food redistribution infrastructure
            </span>

            <h1 className="lp-hero-title">
              The coordination layer
              <br />
              Indonesia&apos;s food banks
              <br />
              <span style={{ color: ACCENT }}>don&apos;t have yet.</span>
            </h1>

            <p className="text-body lp-hero-lede">
              Indonesia is the world&apos;s second-largest food waster while 23 million of its people live below the
              poverty line. Four serious food-rescue organisations already operate at scale — and every one of them
              coordinates through Zoho forms, Excel, or WhatsApp. Lumbung is the software layer between surplus and
              need: six AI agents that route, plan, and prove every donation, with a human approving every allocation.
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <Link href="/orchestrator" className="btn btn-primary">
                See the working system
                <ArrowRight size={15} />
              </Link>
              <a href="#how" className="btn btn-secondary">
                How it works
              </a>
            </div>
          </div>

          {/* The name — the cultural anchor, given room rather than buried */}
          <div
            className="glass-card"
            style={{
              marginTop: 56,
              padding: '26px 28px',
              borderLeft: `3px solid ${ACCENT}`,
              maxWidth: 780,
            }}
          >
            <div className="text-overline" style={{ marginBottom: 10, color: ACCENT }}>
              Lum·bung
            </div>
            <p className="text-body" style={{ margin: 0 }}>
              In pre-modern Indonesian villages, a <em>lumbung</em> was the raised communal granary where households
              pooled surplus rice after each harvest, then drew from it fairly through the lean months — coordinated by
              the whole village rather than whoever shouted loudest. The platform is the same idea rebuilt for 2026:
              pool surplus across a network, route it to where the need is greatest, and let an auditable algorithm
              enforce the fairness a village elder used to.
            </p>
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────────────────── */}
        <section id="problem" className="lp-section">
          <SectionLabel>The problem</SectionLabel>
          <h2 className="text-display" style={{ maxWidth: 620, marginBottom: 14 }}>
            Not a generosity problem. A coordination problem.
          </h2>
          <p className="text-body" style={{ maxWidth: 640, marginBottom: 40 }}>
            The food exists and the need exists, often in the same city on the same day. What&apos;s missing is the
            layer that decides which surplus goes to which branch, at what time, against which spoilage clock.
          </p>

          <div className="grid-stats" style={{ marginBottom: 44 }}>
            {PROBLEM_STATS.map((s) => (
              <div key={s.label} className="glass-card" style={{ padding: '22px 20px' }}>
                <div
                  className="tnum"
                  style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.05 }}
                >
                  {s.value}
                </div>
                <div className="text-caption" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }}>
                  {s.unit}
                </div>
                <div className="text-caption" style={{ color: 'var(--text-primary)', marginBottom: 8 }}>
                  {s.label}
                </div>
                <div className="text-caption" style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                  {s.source}
                </div>
              </div>
            ))}
          </div>

          {/* What the sector runs on today */}
          <div className="glass-card" style={{ padding: '28px 28px 20px' }}>
            <h3 className="text-title-1" style={{ marginBottom: 6 }}>
              What the sector coordinates with today
            </h3>
            <p className="text-body" style={{ marginBottom: 24, maxWidth: 620 }}>
              Every organisation below is real, operating, and doing serious work — on generic tooling never designed
              for spoilage-aware allocation across a branch network.
            </p>

            <div className="flex flex-col">
              {INCUMBENT_TOOLING.map((row, i) => (
                <div
                  key={row.org}
                  className="lp-row"
                  style={{
                    padding: '18px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-default)',
                  }}
                >
                  <div style={{ flex: '0 0 200px' }}>
                    <div className="text-title-2">{row.org}</div>
                    <div className="text-caption" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {row.scale}
                    </div>
                  </div>
                  <div style={{ flex: '0 0 196px' }}>
                    <span className="badge badge-neutral">{row.tooling}</span>
                  </div>
                  <div className="text-caption" style={{ flex: 1, minWidth: 0 }}>
                    {row.gap}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how" className="lp-section">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="text-display" style={{ maxWidth: 640, marginBottom: 14 }}>
            Six agents. One human gate. Zero black boxes.
          </h2>
          <p className="text-body" style={{ maxWidth: 640, marginBottom: 40 }}>
            Every agent calls real tools that read real data — proximity, spare capacity, spoilage risk, fleet
            availability, storage headroom. The model can&apos;t invent a number; it can only decide whether to act on
            the real one it was handed. Every call it makes is recorded and inspectable after the fact.
          </p>

          <div className="flex flex-col gap-3">
            {PIPELINE.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.step} className="glass-card flex items-start gap-4" style={{ padding: '22px 24px' }}>
                  <div
                    className="flex items-center justify-center rounded-lg flex-shrink-0"
                    style={{ width: 38, height: 38, background: 'var(--bg-elevated)', color: ACCENT }}
                  >
                    <Icon size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-2.5" style={{ marginBottom: 5 }}>
                      <span className="text-overline tnum" style={{ color: ACCENT }}>
                        {s.step}
                      </span>
                      <span className="text-title-2">{s.title}</span>
                    </div>
                    <p className="text-caption" style={{ margin: 0, maxWidth: 720 }}>
                      {s.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── AI/human boundary ────────────────────────────────────────── */}
        <section id="boundary" className="lp-section">
          <SectionLabel>The AI / human boundary</SectionLabel>
          <h2 className="text-display" style={{ maxWidth: 640, marginBottom: 14 }}>
            The AI can stop something. It can never start something.
          </h2>
          <p className="text-body" style={{ maxWidth: 640, marginBottom: 40 }}>
            Most &ldquo;AI for good&rdquo; products are vague about where the model&apos;s authority ends. Lumbung is
            specific, and the boundary is enforced in code rather than promised in policy.
          </p>

          <div className="grid-thirds">
            {BOUNDARY.map((b) => {
              const color =
                b.tone === 'critical' ? 'var(--critical)' : b.tone === 'success' ? 'var(--success)' : 'var(--accent)';
              return (
                <div
                  key={b.who}
                  className="glass-card"
                  style={{ padding: '24px 22px', borderTop: `3px solid ${color}` }}
                >
                  <div className="text-overline" style={{ color, marginBottom: 12 }}>
                    {b.who}
                  </div>
                  <p className="text-body" style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 10 }}>
                    {b.what}
                  </p>
                  <p className="text-caption" style={{ margin: 0 }}>
                    {b.bound}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Regulatory tailwind ──────────────────────────────────────── */}
        <section className="lp-section">
          <SectionLabel>Why now</SectionLabel>
          <div className="grid-main" style={{ alignItems: 'start', gap: 24 }}>
            <div>
              <h2 className="text-display" style={{ maxWidth: 560, marginBottom: 14 }}>
                The audit trail becomes a legal requirement in 2027.
              </h2>
              <p className="text-body" style={{ maxWidth: 600, marginBottom: 18 }}>
                Indonesia&apos;s OJK ratified national Sustainability Disclosure Standards (PSPK 1 and 2) in July 2025,
                aligned with IFRS S1/S2. PSPK 2 requires quantitative climate disclosures including waste indicators —
                precisely the data category that food-waste diversion tracking produces.
              </p>
              <p className="text-body" style={{ maxWidth: 600, margin: 0 }}>
                Lumbung generates that record as a byproduct of normal operations. The charity gets coordination it
                can&apos;t currently buy; the corporate donor gets the defensible number their auditor is about to ask
                for. Same data, two customers.
              </p>
            </div>

            <div className="glass-card" style={{ padding: '22px 22px 12px' }}>
              <div className="text-overline" style={{ marginBottom: 16 }}>
                OJK PSPK phase-in
              </div>
              {[
                { group: 'Group 1', who: 'Main-board issuers, major banks', from: 'Jan 2027', active: true },
                { group: 'Group 2', who: 'Development-board issuers', from: 'Jan 2028', active: false },
                { group: 'Group 3', who: 'Asset managers, public-interest entities', from: 'Jan 2029', active: false },
              ].map((g, i) => (
                <div
                  key={g.group}
                  className="flex items-start gap-3"
                  style={{ padding: '14px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-default)' }}
                >
                  <Clock3
                    size={15}
                    color={g.active ? ACCENT : 'var(--text-tertiary)'}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="text-title-2" style={{ fontSize: 14 }}>
                      {g.group}{' '}
                      <span className="tnum" style={{ color: g.active ? ACCENT : 'var(--text-tertiary)' }}>
                        · {g.from}
                      </span>
                    </div>
                    <div className="text-caption" style={{ fontSize: 11.5 }}>
                      {g.who}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Build status ─────────────────────────────────────────────── */}
        <section className="lp-section">
          <SectionLabel>Status</SectionLabel>
          <h2 className="text-display" style={{ maxWidth: 640, marginBottom: 14 }}>
            A working system, and an honest list of what it isn&apos;t yet.
          </h2>
          <p className="text-body" style={{ maxWidth: 640, marginBottom: 40 }}>
            The coordination engine is built and running, not a prototype rendered for a deck. What it still needs for
            the Indonesian market is named below rather than glossed over.
          </p>

          <div className="grid-halves">
            <div className="glass-card" style={{ padding: '26px 24px' }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 18 }}>
                <CircleCheck size={16} color="var(--success)" />
                <span className="text-title-2">Built and running</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {BUILT.map((b) => (
                  <div key={b} className="flex items-start gap-2.5">
                    <CircleCheck
                      size={13}
                      color="var(--success)"
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                    <span className="text-caption" style={{ color: 'var(--text-primary)' }}>
                      {b}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card" style={{ padding: '26px 24px' }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 18 }}>
                <CircleDashed size={16} color="var(--text-tertiary)" />
                <span className="text-title-2">Required for Indonesia — not built yet</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {NEXT.map((n) => (
                  <div key={n.label} className="flex items-start gap-2.5">
                    <span
                      className="badge badge-neutral tnum"
                      style={{ fontSize: 10, padding: '1px 7px', marginTop: 1, flexShrink: 0 }}
                    >
                      {n.priority}
                    </span>
                    <span className="text-caption">{n.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The two objections that decide adoption */}
          <div className="grid-halves" style={{ marginTop: 14 }}>
            <div className="glass-card flex items-start gap-3.5" style={{ padding: '22px 24px' }}>
              <MessageCircle size={17} color={ACCENT} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <div className="text-title-2" style={{ marginBottom: 5 }}>
                  &ldquo;I don&apos;t have time for another app&rdquo;
                </div>
                <p className="text-caption" style={{ margin: 0 }}>
                  Answered with a WhatsApp-first donor flow: one message and a photo, parsed into a structured listing.
                  No install, no account, no login during a busy service.
                </p>
              </div>
            </div>

            <div className="glass-card flex items-start gap-3.5" style={{ padding: '22px 24px' }}>
              <FileCheck2 size={17} color={ACCENT} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <div className="text-title-2" style={{ marginBottom: 5 }}>
                  &ldquo;I&apos;m worried about liability&rdquo;
                </div>
                <p className="text-caption" style={{ margin: 0 }}>
                  Answered by surfacing the legal protections that apply to food donors at the moment of donation,
                  rather than leaving the donor to guess at their exposure.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Roadmap ──────────────────────────────────────────────────── */}
        <section id="roadmap" className="lp-section">
          <SectionLabel>Roadmap</SectionLabel>
          <h2 className="text-display" style={{ maxWidth: 640, marginBottom: 14 }}>
            Earn the case study, then sell the proof.
          </h2>
          <p className="text-body" style={{ maxWidth: 640, marginBottom: 40 }}>
            Partner-first, not customer-first. A cold pitch to a food bank in Month 1 fails; a quiet pilot that
            produces a testimonial in Month 3 opens every door after it.
          </p>

          <div className="flex flex-col gap-3">
            {PHASES.map((p, i) => (
              <div
                key={p.phase}
                className="glass-card lp-row lp-row-center"
                style={{ padding: '22px 24px' }}
              >
                <div style={{ flex: '0 0 132px' }}>
                  <div className="text-overline" style={{ color: i === 0 ? ACCENT : 'var(--text-tertiary)' }}>
                    {p.phase}
                  </div>
                  <div className="text-caption tnum" style={{ fontSize: 11.5 }}>
                    {p.window}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-title-2" style={{ marginBottom: 4 }}>
                    {p.title}
                  </div>
                  <p className="text-caption" style={{ margin: 0 }}>
                    {p.body}
                  </p>
                </div>
                <div style={{ flex: '0 0 190px' }}>
                  <span className="text-caption tnum" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {p.revenue}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <section style={{ padding: '72px 0 0', borderTop: '1px solid var(--border-default)' }}>
          <div
            className="glass-card-primary"
            style={{ padding: '52px 44px', textAlign: 'center' }}
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 46, height: 46, background: ACCENT, color: '#fff', margin: '0 auto 22px' }}
            >
              <LumbungMark size={25} color="#fff" />
            </div>
            <h2 className="text-display" style={{ maxWidth: 560, margin: '0 auto 14px' }}>
              The system is live. Go use it.
            </h2>
            <p className="text-body" style={{ maxWidth: 520, margin: '0 auto 28px' }}>
              Submit a donation and watch it get safety-checked, routed, approved, planned and dispatched — with every
              agent&apos;s reasoning visible at each step.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/donate" className="btn btn-primary">
                Submit a donation
                <ArrowRight size={15} />
              </Link>
              <Link href="/orchestrator" className="btn btn-secondary">
                Open the operations view
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          padding: '28px 24px',
        }}
      >
        <div
          className="flex items-center justify-between gap-4 flex-wrap"
          style={{ maxWidth: 1120, margin: '0 auto' }}
        >
          <div className="flex items-center gap-2.5">
            <LumbungMark size={17} color="var(--text-tertiary)" />
            <span className="text-caption">
              Lumbung — a coordination layer for Indonesian food redistribution
            </span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/recipient" className="text-caption">
              Browse food
            </Link>
            <Link href="/donate" className="text-caption">
              Donate
            </Link>
            <Link href="/orchestrator" className="text-caption">
              Operations
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
