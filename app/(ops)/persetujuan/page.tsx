import {Pagination} from '@/components/operations/Pagination';
import {readPage} from '@/src/ui/pagination';
import {CommandForm,reason} from '@/components/operations/CommandForm';
import {makeT} from '@/src/i18n';
import type {PendingApproval} from '@/src/application/operations/queries';
import {Section} from '../ringkasan/_parts';
import { Header } from '@/components/layout/Header';
import { WorkflowPanels } from '@/components/direct/WorkflowPanels';
import { directPage } from '@/src/application/direct/page-context';
import { listCampaigns } from '@/src/application/direct/queries';
export default async function ApprovalsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const offset=await readPage(searchParams);const {t,tx,actor,locale}=await directPage();const rows=await tx(c=>listCampaigns(c,null,offset));const ot=makeT('ops',locale);const can=(cap:string)=>actor.capabilities.some(c=>c===cap);const pending=await tx(async c=>({stock:(await c.query<PendingApproval>("SELECT id,revision,reason,requested_delta::text,requester_id FROM lumbung.stock_adjustment_requests WHERE state='REQUESTED' ORDER BY created_at")).rows,receipts:(await c.query<PendingApproval>("SELECT id,revision,reason,requester_id FROM lumbung.receipt_correction_requests WHERE state='REQUESTED' ORDER BY created_at")).rows}));
  return <><Header title={t('approvals')}/><div className="direct-page"><p>{t('outreach')} → {t('finalApproval')}</p><WorkflowPanels campaigns={rows} actor={actor} locale={locale}/>{[['stock',ot('stockCorrection')],['receipts',ot('receiptCorrection')]].map(([kind,title])=><Section key={kind} id={kind} title={title}>{pending[kind as 'stock'|'receipts'].map(r=><article className="direct-card" key={r.id}><p>{r.reason} · {r.requested_delta}</p><CommandForm url={kind==='stock'?`/api/adjustments/${r.id}/approve`:`/api/receipt-corrections/${r.id}/approve`} label="approve" base={{expected_revision:r.revision}} fields={[reason]} allowed={can(kind==='stock'?'inventory.adjust.approve':'receipt.correct.approve')&&r.requester_id!==actor.userId}/></article>)}{!pending[kind as 'stock'|'receipts'].length&&<p>{ot('empty')}</p>}</Section>)}<Pagination offset={offset} hasNext={rows.length===50}/></div></>;
}
