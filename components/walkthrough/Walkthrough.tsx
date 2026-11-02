'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpen, ChevronLeft, ChevronRight, Crosshair, X } from 'lucide-react';
import { useLocale } from '@/src/i18n/client';
import type { NavItem } from '@/src/ui/nav';
import { TOUR_STEPS } from './steps';
import { useSpotlight } from './useSpotlight';

const storageKey = 'lumbung.walkthrough.v2';
const eventName = 'lumbung-walkthrough-change';
let memory = '';
function read() { try { return sessionStorage.getItem(storageKey) ?? memory; } catch { return memory; } }
function write(value: string) { memory = value; try { sessionStorage.setItem(storageKey, value); } catch { /* The tour remains usable when storage is blocked. */ } window.dispatchEvent(new Event(eventName)); }
function subscribe(notify: () => void) { window.addEventListener(eventName, notify); return () => window.removeEventListener(eventName, notify); }
const serverSnapshot = () => '';

export function Walkthrough({ nav }: { nav: readonly NavItem[] }) {
  const id = useLocale() === 'id';
  const language = id ? 0 : 1;
  const router = useRouter();
  const pathname = usePathname();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const value = useSyncExternalStore(subscribe, read, serverSnapshot);
  const allowed = useMemo(() => TOUR_STEPS.filter(s => nav.some(n => n.href === s.href) && (!s.requiresHref || nav.some(n => n.href === s.requiresHref))), [nav]);
  const index = allowed.findIndex(s => value === s.id);
  const step = allowed[index];
  const onPage = !!step && pathname === step.href;
  const { geometry, setPopover, reveal } = useSpotlight(step, onPage);
  const close = useCallback((next: '' | 'done') => {
    write(next);
    requestAnimationFrame(() => startRef.current?.focus());
  }, []);
  const readyStep = geometry?.key;
  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close]);
  useEffect(() => {
    if (!readyStep) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [readyStep]);
  function go(next: number) {
    const target = allowed[next];
    if (!target) return;
    write(target.id);
    if (pathname !== target.href) router.push(target.href);
  }
  function resume() {
    if (!step) return;
    if (!onPage) router.push(step.href);
    else { reveal(); headingRef.current?.focus({ preventScroll: true }); }
  }
  const nextLabel = index === allowed.length - 1 ? (id ? 'Selesai membaca' : 'Finish guide') : (id ? 'Berikutnya' : 'Next');
  const navigation = <div className="tour-navigation"><button type="button" className="btn btn-ghost" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={16} aria-hidden="true" />{id ? 'Kembali' : 'Back'}</button><button type="button" className="btn btn-primary" onClick={() => index === allowed.length - 1 ? close('done') : go(index + 1)}>{nextLabel}<ChevronRight size={16} aria-hidden="true" /></button></div>;

  return <>
    <aside className="walkthrough" aria-label={id ? 'Panduan aplikasi' : 'App guide'}>
      <div className="walkthrough-header"><span className="walkthrough-label"><BookOpen size={18} aria-hidden="true" />{id ? 'Panduan dengan sorotan' : 'Spotlight walkthrough'}</span>{step && <button type="button" className="walkthrough-close" onClick={() => close('')} aria-label={id ? 'Tutup panduan' : 'Close guide'}><X size={18} aria-hidden="true" /></button>}</div>
      <div className="walkthrough-welcome"><p>{step ? (onPage ? `${id ? 'Langkah' : 'Step'} ${index + 1} / ${allowed.length} · ${step.title[language]}` : (id ? 'Panduan dijeda saat Anda menjelajah. Lanjutkan kapan saja.' : 'The tour is paused while you explore. Continue whenever you’re ready.')) : value === 'done' ? (id ? 'Panduan selesai. Buka lagi kapan saja.' : 'Guide finished. Revisit it any time.') : (id ? 'Ikuti sorotan untuk mengenal kontrol dan tindakan, satu per satu.' : 'Follow the spotlight to learn the controls and actions, one at a time.')}</p>
        {step ? <div className="tour-launcher-actions"><button type="button" className="btn btn-secondary" onClick={resume}><Crosshair size={16} aria-hidden="true" />{id ? 'Tampilkan sorotan' : 'Show spotlight'}</button>{!onPage && navigation}</div> : <button ref={startRef} type="button" className="btn btn-secondary" onClick={() => go(0)}>{value === 'done' ? (id ? 'Ulangi panduan' : 'Restart guide') : (id ? 'Mulai panduan' : 'Start walkthrough')}<ChevronRight size={16} aria-hidden="true" /></button>}
      </div>
    </aside>
    {step && geometry && createPortal(<div className="tour-layer">
      {geometry.anchor && <div className="tour-spotlight" aria-hidden="true" data-testid="tour-spotlight" style={{ left: geometry.anchor.left, top: geometry.anchor.top, width: geometry.anchor.width, height: geometry.anchor.height }} />}
      <section ref={setPopover} className="tour-popover" role="dialog" aria-labelledby="tour-title" aria-describedby="tour-description" style={{ left: geometry.position.left, top: geometry.position.top, width: Math.min(360, geometry.viewport.width - 32), maxHeight: geometry.maxHeight }}>
        {geometry.anchor && <span aria-hidden="true" className={`tour-pointer tour-pointer-${geometry.position.side}`} style={{ '--tour-arrow': `${geometry.position.arrow}px` } as CSSProperties} />}
        <div className="tour-popover-content" style={{ maxHeight: geometry.maxHeight }}><div className="tour-popover-header"><span>{id ? 'Langkah' : 'Step'} {index + 1} / {allowed.length}</span><button type="button" className="walkthrough-close" onClick={() => close('')} aria-label={id ? 'Tutup panduan' : 'Close guide'}><X size={18} aria-hidden="true" /></button></div>
        <h2 ref={headingRef} id="tour-title" tabIndex={-1}>{step.title[language]}</h2>
        <p id="tour-description">{geometry.missing ? (step.id === 'approval' ? (id ? 'Tidak ada tombol persetujuan yang tersedia untuk peran Anda saat ini. Usulan mungkin sudah diproses. Pilih Berikutnya untuk melanjutkan.' : 'No approval action is currently available to your role. Proposals may already be processed. Choose Next to continue.') : (id ? 'Kontrol atau data untuk langkah ini belum tersedia. Periksa filter atau tambahkan data melalui alur biasa, lalu tampilkan sorotan lagi. Anda juga dapat melanjutkan ke langkah berikutnya.' : 'This control or record is not currently available. Check filters or add data through the normal workflow, then show the spotlight again. You can also continue to the next step.')) : step.body[language]}</p>
        {!geometry.missing && <p className="tour-task">{step.action[language]}</p>}
        <button type="button" className="tour-focus-control" onClick={reveal}><Crosshair size={15} aria-hidden="true" />{geometry.anchor ? (id ? 'Fokus ke area ini' : 'Focus this area') : (id ? 'Tunjukkan area yang disorot' : 'Show the highlighted area')}</button>
        {navigation}
        <p className="tour-footnote">{id ? 'Esc untuk menutup. Tur hanya menyorot; tindakan di aplikasi tetap Anda kendalikan.' : 'Esc to close. The tour only highlights; you control all app actions.'}</p></div>
      </section>
    </div>, document.body)}
  </>;
}
