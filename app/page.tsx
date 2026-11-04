import Link from 'next/link';
import Image, { type StaticImageData } from 'next/image';
import {
  ArrowDown, ArrowRight, ArrowUpRight, Boxes, Check, CircleCheck, ClipboardList,
  FileCheck2, GitBranch, Globe2, Hand, LayoutDashboard, MapPin, MessageSquare,
  PackageCheck, ShieldCheck, Truck, Users, Warehouse,
} from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { WorkflowPreview } from '@/components/landing/WorkflowPreview';
import { RevolvingGlobe } from '@/components/landing/RevolvingGlobe';
import { BUILT, INCUMBENT_TOOLING, NEXT, OJK_PHASES, PHASES, PIPELINE, PROBLEM_STATS } from '@/components/landing/content';
import s from '@/components/landing/landing.module.css';
import operationsPreview from '@/public/landing/operations.webp';
import donationPreview from '@/public/landing/donation.webp';
import recommendationPreview from '@/public/landing/recommendation.webp';

const stepIcons = [ShieldCheck, GitBranch, Hand, Truck, CircleCheck];
const networkFeatures = [
  { icon: Globe2, title: 'Coordinate everywhere', body: 'Branch networks, partner beneficiaries, and donors on one shared allocation layer instead of four inboxes.' },
  { icon: MapPin, title: 'Route by what spoils first', body: 'Proximity, fairness, and spoilage risk are scored together, so the food that can’t wait moves first.' },
  { icon: ShieldCheck, title: 'Prove every hand-off', body: 'Collected, delivered, or recycled — the outcome is recorded. No more capacity guesswork.' },
];
const productFeatures = [
  { icon: Users, title: 'FLO network', body: 'Branch networks, partner beneficiaries, and donors on one shared allocation layer.', href: '/flo' },
  { icon: GitBranch, title: 'Fair matching', body: PIPELINE[1].body, href: '/rekomendasi' },
  { icon: Warehouse, title: 'Storage & dispatch', body: PIPELINE[3].body, href: '/persediaan' },
  { icon: FileCheck2, title: 'A closed loop', body: PIPELINE[4].body, href: '/pelaporan' },
];

function Eyebrow({ children, number }: { children: React.ReactNode; number?: string }) {
  return <p className={s.eyebrow}>{number && <span>{number} / </span>}{children}</p>;
}

function ProductImage({ src, alt }: { src: StaticImageData; alt: string }) {
  return <div className={s.productImage}>
    <div className={s.previewBar}><span>lumbung / workspace</span><span>DEMO</span></div>
    <Image src={src} alt={alt} sizes="(max-width: 760px) 90vw, 42vw" />
  </div>;
}

export default function LandingPage() {
  return <div className={s.landing} lang="en">
    <a className={s.skipLink} href="#landing-main">Skip to content</a>
    <LandingNav />
    <main id="landing-main" tabIndex={-1}>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.heroCopy}>
          <Eyebrow>Indonesian food redistribution</Eyebrow>
          <h1 id="hero-title">The coordination layer<br />Indonesia&apos;s food banks<br /><span>don&apos;t have yet.</span></h1>
          <p className={s.heroMeta}>Six AI agents. A human approves every allocation.</p>
          <div className={s.actions}>
            <Link href="/ringkasan" className={`${s.button} ${s.primary}`}>See the working system <ArrowUpRight size={17} aria-hidden="true" /></Link>
            <a href="#how" className={`${s.button} ${s.secondary}`}>How it works <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
        </div>
        <WorkflowPreview />
      </section>

      <section id="problem" className={`${s.section} ${s.problem}`} aria-labelledby="problem-title">
        <div className={s.container}>
          <div className={s.sectionIntro}>
            <Eyebrow number="01">The problem</Eyebrow>
            <h2 id="problem-title"><span>Not a generosity problem.</span><br />A coordination problem.</h2>
            <p className={s.lede}>The food exists and the need exists, often in the same city on the same day. What&apos;s missing is the layer that decides which surplus goes where, at what time, against which spoilage clock.</p>
          </div>
          <div className={s.stats}>
            {PROBLEM_STATS.map(stat => <div key={stat.label} className={s.stat}>
              <strong>{stat.display ?? `${stat.value}${stat.suffix}`}</strong><span>{stat.unit}</span><p>{stat.label}</p>
            </div>)}
          </div>
          <div className={s.problemSplit}>
            <div className={s.currentTools}>
              <Eyebrow>What the sector coordinates with today</Eyebrow>
              <h3>Same mission.<br />Separate inboxes.</h3>
              <p>Every organisation below is real, operating, and doing serious work — on generic tooling never designed for spoilage-aware allocation.</p>
              <div className={s.toolList}>{['Zoho Creator forms', 'Microsoft Excel', 'Phone & WhatsApp', 'Basic app, low adoption', 'Paper logbooks'].map(tool => <span key={tool}>{tool}</span>)}</div>
            </div>
            <div className={s.organisations}>
              <div className={s.listTop}><span>Organisation</span><span>Current tooling</span></div>
              {INCUMBENT_TOOLING.map(org => <div className={s.orgRow} key={org.org}><div><h4>{org.org}</h4><p>{org.scale}</p></div><span>{org.tooling}</span></div>)}
              <p className={s.orgFoot}>4 organisations. One shared coordination problem.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className={`${s.section} ${s.how}`} aria-labelledby="how-title">
        <div className={s.container}>
          <div className={s.sectionIntro}>
            <Eyebrow number="02">How it works</Eyebrow>
            <h2 id="how-title">Six agents. One human gate.<br /><span>Zero black boxes.</span></h2>
            <p className={s.lede}>Every agent calls real tools reading real data — proximity, spare capacity, spoilage risk, fleet availability. It can&apos;t invent a number; it can only decide whether to act on the real one it was handed.</p>
          </div>
          <div className={s.pipeline}>
            {PIPELINE.map((step, index) => {
              const Icon = stepIcons[index];
              return <article key={step.step} className={s.pipelineStep}><span className={s.stepIndex}>{step.step}</span><Icon size={28} strokeWidth={1.5} aria-hidden="true" /><h3>{step.title}</h3><p>{step.body}</p></article>;
            })}
          </div>
          <div className={s.humanGate}>
            <div><ShieldCheck size={30} strokeWidth={1.4} aria-hidden="true" /><h3>The AI can stop something.<br />It can never start something.</h3></div>
            <p>It blocks unsafe submissions on its own. It only ever recommends an allocation — no allocation is auto-committed. Full stop.</p>
          </div>
        </div>
      </section>

      <div className={s.darkRegion}>
        <section id="network" className={`${s.section} ${s.network}`} aria-labelledby="network-title">
          <div className={`${s.container} ${s.technicalFrame}`}>
            <div className={`${s.sectionIntro} ${s.centered}`}>
              <Eyebrow number="03">The network</Eyebrow>
              <h2 id="network-title">Region: Indonesia</h2>
              <p className={s.lede}>One coordination layer across the archipelago —<br className={s.desktopBreak} /> close to the surplus, close to the need.</p>
            </div>
            <div className={s.globeScene}>
              <RevolvingGlobe />
              <div className={`${s.networkCallout} ${s.calloutLeft}`}><MapPin size={18} aria-hidden="true" /><p>Real distance.<br />Real spare capacity.</p></div>
              <div className={`${s.networkCallout} ${s.calloutRight}`}><Hand size={18} aria-hidden="true" /><p>Matched against the spoilage clock.<br />Held for a person to approve.</p></div>
              <span className={s.globeCaption}>Surplus → coordination → need</span>
            </div>
            <div className={s.networkFeatures}>{networkFeatures.map(feature => {
              const Icon = feature.icon;
              return <article key={feature.title}><Icon size={27} strokeWidth={1.45} aria-hidden="true" /><h3>{feature.title}</h3><p>{feature.body}</p></article>;
            })}</div>
          </div>
        </section>

        <section id="product" className={`${s.section} ${s.product}`} aria-labelledby="product-title">
          <div className={s.container}>
            <div className={s.productIntro}>
              <div><Eyebrow number="04">The product</Eyebrow><h2 id="product-title"><span>Not a mockup.</span><br />The system, running.</h2></div>
              <Link href="/ringkasan" className={s.textLink}>Open the operations view <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
            <p className={s.lede}>Live operations, the donor submission flow, and the agent pipeline — every screen below is the working product, not a render.</p>
            <div className={s.productGrid}>
              <Link href="/ringkasan" className={s.productCard}>
                <div className={s.cardCopy}><LayoutDashboard size={24} aria-hidden="true" /><ArrowUpRight className={s.cardArrow} size={20} aria-hidden="true" /><h3>Live operations</h3><p>Live operations — fairness, saturation, deliveries in flight</p></div>
                <ProductImage src={operationsPreview} alt="Lumbung operations dashboard with the work queue and network overview" />
              </Link>
              <Link href="/donasi/baru" className={s.productCard}>
                <div className={s.cardCopy}><PackageCheck size={24} aria-hidden="true" /><ArrowUpRight className={s.cardArrow} size={20} aria-hidden="true" /><h3>Donor submission</h3><p>Donor submission — safety-checked before a listing exists</p></div>
                <ProductImage src={donationPreview} alt="Lumbung donation form for food, quantities, and pickup details" />
              </Link>
              {productFeatures.map(feature => {
                const Icon = feature.icon;
                return <Link key={feature.title} href={feature.href} className={s.featureCard}><Icon size={24} strokeWidth={1.5} aria-hidden="true" /><ArrowUpRight className={s.cardArrow} size={16} aria-hidden="true" /><h3>{feature.title}</h3><p>{feature.body}</p></Link>;
              })}
            </div>
            <Link href="/rekomendasi" className={s.pipelinePreview} data-testid="pipeline-preview">
              <div className={s.pipelineCopy}><GitBranch size={26} aria-hidden="true" /><h3>The agent pipeline,<br />with every tool call inspectable</h3><span className={s.textLink}>Explore the pipeline <ArrowUpRight size={17} aria-hidden="true" /></span></div>
              <div className={s.pipelineScreen}>
                <div className={s.previewBar}><span>lumbung / recommendations</span><span>DEMO</span></div>
                <Image src={recommendationPreview} alt="A real demo recommendation showing the selected FLO, allocation quantity and scoring factors" sizes="(max-width: 900px) 85vw, 50vw" />
              </div>
            </Link>
          </div>
        </section>
      </div>

      <section className={`${s.section} ${s.whyNow}`} aria-labelledby="why-title">
        <div className={`${s.container} ${s.whyGrid}`}>
          <div><Eyebrow number="05">Why now</Eyebrow><h2 id="why-title">The audit trail becomes a legal requirement in 2027.</h2><p className={s.lede}>Indonesia&apos;s OJK ratified Sustainability Disclosure Standards (PSPK 1/2) in July 2025, requiring quantitative waste disclosures from January 2027. Lumbung produces that record as a byproduct of normal operations — the charity gets coordination it can&apos;t buy today; the corporate donor gets the number their auditor is about to require.</p></div>
          <div className={s.phaseIn}><Eyebrow>OJK PSPK phase-in</Eyebrow>{OJK_PHASES.map(phase => <div key={phase.group} className={s.phaseRow}><span className={s.phaseDate}>{phase.from}</span><div><h3>{phase.group}{phase.active && <span className={s.tag}>Next</span>}</h3><p>{phase.who}</p></div></div>)}</div>
        </div>
      </section>

      <section className={`${s.section} ${s.statusSection}`} aria-labelledby="status-title">
        <div className={s.container}>
          <div className={`${s.sectionIntro} ${s.centered}`}><Eyebrow number="06">Status</Eyebrow><h2 id="status-title">A working system,<br /><span>and an honest list of what it isn&apos;t yet.</span></h2></div>
          <div className={s.statusGrid}>
            <div className={s.built}><Eyebrow>Today</Eyebrow><h3>Built<br />and running.</h3><ul>{BUILT.map(item => <li key={item}><Check size={17} aria-hidden="true" /><span>{item}</span></li>)}</ul></div>
            <div className={s.next}><Eyebrow>Up next</Eyebrow><h3>Required<br />for Indonesia.</h3><p className={s.statusNote}>Not built yet</p><ul>{NEXT.map(item => <li key={item.label}><span className={s.priority}>{item.priority}</span><span>{item.label}</span></li>)}</ul></div>
          </div>
          <div className={s.objections}>
            <article><MessageSquare size={23} aria-hidden="true" /><h3>&ldquo;I don&apos;t have time for another app&rdquo;</h3><p>Answered with a WhatsApp-first donor flow: one message and a photo, parsed into a listing. No install, no account, no login during a busy service.</p></article>
            <article><ShieldCheck size={23} aria-hidden="true" /><h3>&ldquo;I&apos;m worried about liability&rdquo;</h3><p>Answered by surfacing the legal protections that apply to food donors at the moment of donation, rather than leaving them to guess at their exposure.</p></article>
          </div>
        </div>
      </section>

      <section id="roadmap" className={`${s.section} ${s.roadmap}`} aria-labelledby="roadmap-title">
        <div className={s.container}><div className={s.sectionIntro}><Eyebrow number="07">Roadmap</Eyebrow><h2 id="roadmap-title"><span>Earn the case study,</span><br />then sell the proof.</h2><p className={s.lede}>Partner-first, not customer-first. A cold pitch to a food bank in Month 1 fails; a quiet pilot that produces a testimonial in Month 3 opens every door after it.</p></div>
          <div className={s.roadmapGrid}>{PHASES.map((phase, index) => <article key={phase.phase}><div className={s.roadmapTop}><span>{phase.phase}</span><span>{phase.window}</span></div><span className={s.roadmapNumber}>0{index + 1}</span><h3>{phase.title}</h3><p>{phase.body}</p><span className={s.revenue}>{phase.revenue}</span></article>)}</div>
        </div>
      </section>

      <section className={s.closing} aria-labelledby="closing-title">
        <div className={s.closingIcons} aria-hidden="true">{[Boxes, Users, ClipboardList, Truck, ShieldCheck, Globe2].map((Icon, index) => <div key={index}><Icon size={28} strokeWidth={1.3} /></div>)}</div>
        <div className={s.closingCopy}><Eyebrow>Lumbung</Eyebrow><h2 id="closing-title">The system is live.<br /><span>Go use it.</span></h2><p className={s.lede}>Submit a donation and watch it get safety-checked, routed, approved, planned and dispatched — with every agent&apos;s reasoning visible at each step.</p><div className={s.actions}><Link href="/donasi/baru" className={`${s.button} ${s.primary}`}>Submit a donation <ArrowUpRight size={17} aria-hidden="true" /></Link><Link href="/ringkasan" className={`${s.button} ${s.secondary}`}>Open the operations view <ArrowRight size={17} aria-hidden="true" /></Link></div></div>
      </section>
    </main>
    <footer className={s.footer}><div className={s.container}><div className={s.footerBrand}><Link href="/" className={s.brand}><Image src="/brand/logo-mark-black.png" width={32} height={32} alt="" /><span>lumbung.</span></Link><p>A coordination layer for<br />Indonesian food redistribution.</p></div><nav aria-label="Footer navigation"><Link href="/flo">Browse food <ArrowUpRight size={14} aria-hidden="true" /></Link><Link href="/donasi">Donate <ArrowUpRight size={14} aria-hidden="true" /></Link><Link href="/ringkasan">Operations <ArrowUpRight size={14} aria-hidden="true" /></Link></nav><a href="#hero-title" className={s.backTop}>Back to top <ArrowUpRight size={15} aria-hidden="true" /></a></div></footer>
  </div>;
}
