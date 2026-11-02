import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Locale } from '@/src/i18n';
import { codeLabel, statusTone } from '@/src/ui/presentation';

export function StatusBadge({ code, locale }: { code: string; locale: Locale }) {
  return <span className={`record-status record-status-${statusTone(code)}`}>{codeLabel(code, locale)}</span>;
}
export function RecordHeading({ href, title, code }: { href: string; title: string; code?: string }) {
  return <div className="record-heading">{code && <p className="record-reference">{code}</p>}<h3><Link href={href}>{title}</Link></h3></div>;
}
export function RecordFacts({ children }: { children: ReactNode }) { return <dl className="record-facts">{children}</dl>; }
export function RecordFact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
