'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import s from './landing.module.css';

const links = [['Problem', '#problem'], ['How it works', '#how'], ['Network', '#network'], ['Product', '#product'], ['Roadmap', '#roadmap']] as const;

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return <header className={s.header}>
    <div className={s.navBar}>
      <Link href="/" className={s.brand} aria-label="Lumbung home">
        <Image src="/brand/logo-mark-black.png" width={32} height={32} alt="" />
        <span>lumbung<span className={s.brandPeriod}>.</span></span>
      </Link>
      <nav aria-label="Main navigation" className={s.desktopNav}>
        {links.map(([label, href]) => <a href={href} key={href}>{label}</a>)}
      </nav>
      <div className={s.navActions}>
        <Link href="/masuk" className={s.signIn}>Sign in</Link>
        <Link href="/ringkasan" className={`${s.button} ${s.primary} ${s.navCta}`}>Live product <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <button ref={toggle} type="button" className={s.menuToggle} aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="landing-mobile-nav" onClick={() => setOpen(!open)}>
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </div>
    <nav id="landing-mobile-nav" aria-label="Mobile navigation" className={s.mobileNav} hidden={!open}>
      {links.map(([label, href]) => <a href={href} key={href} onClick={() => setOpen(false)}>{label}<ArrowUpRight size={16} aria-hidden="true" /></a>)}
      <Link href="/masuk" onClick={() => setOpen(false)}>Sign in<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </nav>
  </header>;
}
