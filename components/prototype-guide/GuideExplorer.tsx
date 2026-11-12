'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Pause, Play, RotateCcw } from 'lucide-react';
import type { Locale } from '@/src/i18n/types';
import { guideCopy } from './content';
import { GUIDE_ICONS, type GuideMap, type GuideNode } from './model';
import styles from './guide.module.css';

interface DrawnEdge { from: string; to: string; d: string; both?: boolean }

function revealNode(button: HTMLButtonElement | undefined) {
  if (!button) return;
  const compact = (button.closest('section')?.clientWidth ?? 0) <= 850;
  button.scrollIntoView({ block: compact ? 'start' : 'nearest', behavior: 'instant' });
}

export function GuideExplorer({ map, locale, allowedPaths }: {
  map: GuideMap;
  locale: Locale;
  allowedPaths: string[];
}) {
  const copy = guideCopy(locale);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useState<{ width: number; height: number; edges: DrawnEdge[] }>({ width: 1, height: 1, edges: [] });
  const grid = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const marker = useId().replaceAll(':', '');
  const current = map.nodes[index];
  const Icon = GUIDE_ICONS[current.icon];

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    function measure() {
      const outer = element!.getBoundingClientRect();
      const edges = map.edges.flatMap(edge => {
        const from = buttons.current.get(edge.from)?.getBoundingClientRect();
        const to = buttons.current.get(edge.to)?.getBoundingClientRect();
        if (!from || !to) return [];
        const a = { x: from.x - outer.x, y: from.y - outer.y, w: from.width, h: from.height };
        const b = { x: to.x - outer.x, y: to.y - outer.y, w: to.width, h: to.height };
        let d: string;
        if (Math.abs(a.y - b.y) < 8) {
          const right = b.x > a.x;
          const x1 = right ? a.x + a.w + 4 : a.x - 4;
          const x2 = right ? b.x - 8 : b.x + b.w + 8;
          d = `M ${x1} ${a.y + a.h / 2} L ${x2} ${b.y + b.h / 2}`;
        } else {
          const down = b.y > a.y;
          const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2;
          const y1 = down ? a.y + a.h + 4 : a.y - 4;
          const y2 = down ? b.y - 8 : b.y + b.h + 8;
          const mid = (y1 + y2) / 2;
          d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
        }
        return [{ ...edge, d }];
      });
      setDrawing({ width: outer.width, height: outer.height, edges });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    buttons.current.forEach(button => observer.observe(button));
    // A font can finish loading without changing the grid's outer dimensions.
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    measure();
    return () => { active = false; observer.disconnect(); };
  }, [map]);

  useEffect(() => {
    if (!playing) return;
    revealNode(buttons.current.get(map.nodes[index].id));
    const timer = window.setTimeout(() => {
      if (index >= map.nodes.length - 2) setPlaying(false);
      setIndex(value => Math.min(value + 1, map.nodes.length - 1));
      window.requestAnimationFrame(() => revealNode(buttons.current.get(map.nodes[Math.min(index + 1, map.nodes.length - 1)].id)));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [playing, index, map.nodes]);

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  function select(next: number, focus = false) {
    const position = Math.max(0, Math.min(next, map.nodes.length - 1));
    setPlaying(false);
    setIndex(position);
    window.requestAnimationFrame(() => {
      const button = buttons.current.get(map.nodes[position].id);
      if (focus) button?.focus({ preventScroll: true });
      if (focus || (button?.closest('section')?.clientWidth ?? 0) <= 850) revealNode(button);
    });
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? position + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? position - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? map.nodes.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  }

  const inspector = (location: string) => (
    <Inspector node={current} map={map} locale={locale} allowedPaths={allowedPaths}
      instance={`${map.id}-${location}`} onSelect={id => select(map.nodes.findIndex(node => node.id === id), true)} />
  );

  return (
    <section className={styles.explorer} aria-labelledby={`${map.id}-title`}>
      <header className={styles.mapHeader}>
        <p className={styles.eyebrow}>{map.label}</p>
        <h2 id={`${map.id}-title`}>{map.title}</h2>
        <p>{map.description}</p>
      </header>

      <div className={styles.legend} aria-label={copy.legend}>
        {(['person', 'system', 'gate', 'store'] as const).map(kind => (
          <span key={kind}><i data-kind={kind} aria-hidden="true" />{copy.kinds[kind]}</span>
        ))}
        <span><ArrowRight size={16} aria-hidden="true" />{map.sequence ? copy.arrow : copy.relationship}</span>
      </div>

      <div className={styles.controls}>
        <div className={styles.progress} aria-live="polite" aria-atomic="true">
          <Icon size={19} aria-hidden="true" />
          <span>{map.sequence ? copy.step : copy.component} {index + 1} {copy.of} {map.nodes.length}<strong>{current.title}</strong></span>
        </div>
        <div className={styles.buttons}>
          <button type="button" onClick={() => select(index - 1, true)} disabled={index === 0} aria-label={copy.previous}><ArrowLeft size={17} aria-hidden="true" /></button>
          {map.sequence && <button type="button" className={styles.play} aria-pressed={playing} onClick={() => {
            if (playing) setPlaying(false);
            else { if (index === map.nodes.length - 1) setIndex(0); setPlaying(true); }
          }}>
            {playing ? <Pause size={16} aria-hidden="true" /> : index === map.nodes.length - 1 ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {playing ? copy.pause : index === map.nodes.length - 1 ? copy.restart : copy.play}
          </button>}
          <button type="button" onClick={() => select(index + 1, true)} disabled={index === map.nodes.length - 1} aria-label={copy.next}><ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      </div>
      {map.sequence && <p className={styles.playbackNote}>{playing ? copy.timing : copy.motion}</p>}

      <div className={styles.mapLayout}>
        <div className={styles.canvas}>
          <div className={styles.canvasLabel}><span>{copy.select}</span><span>{map.sequence ? '01 → ' + String(map.nodes.length).padStart(2, '0') : 'NEXT.JS / POSTGRESQL'}</span></div>
          <div ref={grid} className={styles.nodeGrid} data-sequence={map.sequence} data-testid="guide-graph">
            <svg className={styles.edges} viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true">
              <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" strokeWidth="1.25" /></marker></defs>
              {drawing.edges.map((edge, i) => {
                const highlighted = edge.from === current.id || (!map.sequence && edge.to === current.id);
                return <g key={`${edge.from}-${edge.to}`} className={highlighted ? styles.activeEdge : undefined}>
                  <path data-edge={`${edge.from}:${edge.to}`} d={edge.d} fill="none" markerEnd={`url(#${marker})`} markerStart={edge.both ? `url(#${marker})` : undefined} />
                  {playing && i === index && <circle key={index} r="4" className={styles.packet}><animateMotion dur="6s" path={edge.d} repeatCount="1" fill="freeze" /></circle>}
                </g>;
              })}
            </svg>
            {map.nodes.map((item, i) => {
              const ItemIcon = GUIDE_ICONS[item.icon];
              const row = item.row ?? Math.floor(i / 3);
              const column = item.column ?? (row % 2 === 0 ? i % 3 : 2 - i % 3);
              return <div key={item.id} className={styles.nodeSlot} style={{ '--column': column + 1, '--row': row + 1 } as CSSProperties}>
                <button type="button" ref={button => { if (button) buttons.current.set(item.id, button); else buttons.current.delete(item.id); }}
                  data-node-id={item.id} data-kind={item.kind} aria-pressed={index === i}
                  className={styles.node} onClick={() => select(i)} onKeyDown={event => navigate(event, i)}>
                  <span className={styles.nodeTop} style={{ color: index === i ? '#d2d2d2' : '#5c5c5c' }}><span>{String(i + 1).padStart(2, '0')} <span className={styles.nodeKind}>{copy.kinds[item.kind]}</span></span><ItemIcon size={18} aria-hidden="true" /></span>
                  <strong>{item.title}</strong><span className={styles.nodeSummary}>{item.summary}</span>
                </button>
                {i === index && <div className={styles.inlineInspector}>{inspector('inline')}</div>}
                {map.sequence && i < map.nodes.length - 1 && <div className={styles.mobileArrow} aria-hidden="true"><ArrowDown size={23} /></div>}
              </div>;
            })}
          </div>
        </div>
        <div className={styles.sideInspector}>{inspector('side')}</div>
      </div>

      <div className={styles.takeaway}><GitBranchIcon /><div><strong>{copy.takeaway}</strong><p>{map.takeaway}</p></div></div>
    </section>
  );
}

function GitBranchIcon() { const Icon = GUIDE_ICONS.GitBranch; return <Icon size={23} aria-hidden="true" />; }

function Inspector({ node, map, locale, allowedPaths, instance, onSelect }: {
  node: GuideNode; map: GuideMap; locale: Locale; allowedPaths: string[]; instance: string; onSelect: (id: string) => void;
}) {
  const c = guideCopy(locale);
  const connections = map.edges.filter(edge => edge.from === node.id || (edge.both && edge.to === node.id));
  const incoming = map.sequence ? [] : map.edges.filter(edge => edge.to === node.id && !edge.both);
  return <article className={styles.inspector} aria-labelledby={`${instance}-title`} data-testid={`guide-detail-${instance.endsWith('inline') ? 'inline' : 'side'}`}>
    <p className={styles.eyebrow}>{c.kinds[node.kind]}</p>
    <h3 id={`${instance}-title`}>{node.title}</h3>
    <p className={styles.owner}>{node.owner}</p>
    <dl>
      {([['input', node.input], ['action', node.action], ['output', node.output], ['exception', node.exception]] as const).map(([key, value]) => <div key={key}>
        <dt>{c[key]}</dt><dd>{value}</dd>
      </div>)}
    </dl>
    {node.example && <div className={styles.example}><strong>{c.example}</strong><p>{node.example}</p></div>}
    {node.href && (allowedPaths.includes(node.href) ? <Link href={node.href} className={styles.openLink}>{c.open}<ArrowUpRight size={17} aria-hidden="true" /></Link> : <p className={styles.restricted}>{c.restricted}</p>)}
    {(connections.length > 0 || incoming.length > 0) && <div className={styles.connections}>
      {connections.length > 0 && <p>{c.connections}</p>}
      {connections.map(edge => {
        const id = edge.from === node.id ? edge.to : edge.from;
        return <button type="button" key={id} onClick={() => onSelect(id)}><ArrowRight size={14} aria-hidden="true" />{map.nodes.find(item => item.id === id)?.title}</button>;
      })}
      {incoming.length > 0 && <p>{c.incoming}</p>}
      {incoming.map(edge => <button type="button" key={edge.from} onClick={() => onSelect(edge.from)}><ArrowLeft size={14} aria-hidden="true" />{map.nodes.find(item => item.id === edge.from)?.title}</button>)}
    </div>}
    <details className={styles.references}><summary>{c.source}<ChevronDown size={14} aria-hidden="true" /></summary><ul>{node.source.map(source => <li key={source}><code>{source}</code></li>)}</ul></details>
  </article>;
}
