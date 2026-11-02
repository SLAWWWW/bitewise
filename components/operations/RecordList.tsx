'use client';

import { useId, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useLocale } from '@/src/i18n/client';

export interface RecordEntry { id: string; search: string; status: string; content: ReactNode }

/** Filters only the current server page; pagination remains server controlled. */
export function RecordList({ records }: { records: RecordEntry[] }) {
  const id = useLocale() === 'id';
  const inputId = useId();
  const selectId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const options = [...new Set(records.map(r => r.status))].sort();
  const visible = records.filter(r => (!status || r.status === status) && r.search.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="record-list">
    <div className="record-toolbar">
      <div className="record-search">
        <label htmlFor={inputId}>{id ? 'Cari di halaman ini' : 'Search this page'}</label>
        <div><Search size={17} aria-hidden="true" /><input id={inputId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={id ? 'Nama atau kode…' : 'Name or reference…'} /></div>
      </div>
      <div className="record-filter"><label htmlFor={selectId}>Status</label><select id={selectId} value={status} onChange={e => setStatus(e.target.value)}><option value="">{id ? 'Semua status' : 'All statuses'}</option>{options.map(s => <option key={s}>{s}</option>)}</select></div>
      <p className="record-count" role="status">{visible.length} / {records.length} {id ? 'di halaman ini' : 'on this page'}</p>
    </div>
    <div className="record-rows">{visible.map(r => <article className="record-row" key={r.id}>{r.content}</article>)}</div>
    {!visible.length && <div className="record-empty"><p>{id ? 'Tidak ada data yang cocok di halaman ini.' : 'No matching records on this page.'}</p>{(query || status) && <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setStatus(''); }}>{id ? 'Hapus filter' : 'Clear filters'}</button>}</div>}
  </div>;
}
