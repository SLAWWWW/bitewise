'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Circle, MoveRight, CircleCheck, GitBranch, Hand, Pause, Play, ShieldCheck, Truck } from 'lucide-react';
import { PIPELINE } from './content';
import { useMotion } from './useMotion';
import s from './landing.module.css';

const icons = [ShieldCheck, GitBranch, Hand, Truck, CircleCheck];

/** A small, keyboard-accessible product explainer; selecting a step never runs it. */
export function WorkflowPreview() {
  const [selected, setSelected] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const motion = useMotion(root);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!motion.running) return;
    const timer = window.setTimeout(() => setSelected(index => (index + 1) % PIPELINE.length), 3600);
    return () => window.clearTimeout(timer);
  }, [motion.running, selected]);

  function select(index: number) {
    motion.pause();
    setSelected(index);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % PIPELINE.length;
    else if (event.key === 'ArrowLeft') next = (index + PIPELINE.length - 1) % PIPELINE.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PIPELINE.length - 1;
    else return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }
  const step = PIPELINE[selected];
  return <div ref={root} className={s.workflow} data-testid="workflow-preview" data-motion={motion.running ? 'running' : 'paused'}>
    <div className={s.workflowTabs} role="tablist" aria-label="Explore the donation workflow">
      {PIPELINE.map((item, index) => {
        const Icon = icons[index];
        return <div className={s.workflowItem} key={item.step} role="presentation">
          <button type="button" role="tab" id={`flow-tab-${index}`} aria-selected={selected === index} aria-controls="flow-panel" tabIndex={selected === index ? 0 : -1} ref={element => { tabs.current[index] = element; }} onKeyDown={event => onKeyDown(event, index)} onFocus={motion.pause} onClick={() => select(index)} className={s.workflowTab}>
            <span className={s.nodeIcon}><Icon size={32} strokeWidth={1.45} aria-hidden="true" /></span>
            <span className={s.nodeTitle}>{item.title}</span>
            <span className={s.nodeNumber}>{item.step}</span>
          </button>
          {index < PIPELINE.length - 1 && <span className={s.connector} aria-hidden="true">
            <MoveRight className={s.connectorLine} preserveAspectRatio="none" strokeWidth={1} />
            {selected === index && motion.running && <Circle className={s.workflowPacket} size={8} fill="currentColor" data-testid="workflow-packet" />}
          </span>}
        </div>;
      })}
    </div>
    <div id="flow-panel" className={s.workflowPanel} role="tabpanel" aria-labelledby={`flow-tab-${selected}`} tabIndex={0}>
      <span className={s.smallLabel}>Step {step.step}</span><p>{step.body}</p>
    </div>
    <div className={s.workflowControls}>
      <span className={s.workflowHint}>Select any step to explore</span>
      <button type="button" className={s.motionButton} onClick={motion.toggle} aria-label={motion.enabled ? 'Pause workflow animation' : 'Play workflow animation'}>
        {motion.enabled ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
        {motion.enabled ? 'Pause' : 'Play'}
      </button>
    </div>
  </div>;
}
