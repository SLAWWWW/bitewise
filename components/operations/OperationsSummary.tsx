import Link from 'next/link';
import {codeLabel} from '@/src/ui/presentation';
import {StatusBadge} from './RecordParts';
import {Section} from '@/app/(ops)/ringkasan/_parts';
import {directPage} from '@/src/application/direct/page-context';
import {tasks} from '@/src/application/operations/queries';
import {CommandForm,reason} from './CommandForm';
import {makeT} from '@/src/i18n';
import type {Plan} from '@/src/domain/allocation/planner';
import {jainDiagnostic} from '@/src/domain/allocation/jain';
export async function OperationsSummary(){const {tx,locale,can}=await directPage();const t=makeT('ops',locale);const id=locale==='id';const data=await tx(async c=>({tasks:await tasks(c),counts:(await c.query<{inbound:number;overdue:number;near:number;physical:number;review:number;unknown:number}>(`SELECT
 (SELECT count(*)::int FROM lumbung.expected_inbounds WHERE state NOT IN('CLOSED','CANCELLED') AND expected_at<lumbung.tenant_now()+interval '1 day') AS inbound,
 (SELECT count(*)::int FROM lumbung.evidence_obligations WHERE state IN('OPEN','NEEDS_CLARIFICATION','REJECTED_FINAL') AND due_at<lumbung.tenant_now()) AS overdue,
 (SELECT count(*)::int FROM lumbung.inventory_batches WHERE least(expires_at,handling_deadline)<lumbung.tenant_now()+interval '7 days') AS near,
 (SELECT count(*)::int FROM lumbung.deliveries WHERE state IN('RECEIVED','PARTIALLY_RECEIVED')) AS physical,
 (SELECT count(*)::int FROM lumbung.evidence_obligations WHERE state IN('SUBMITTED','UNDER_REVIEW')) AS review,
 (SELECT count(*)::int FROM lumbung.tasks WHERE kind='SEND_RECONCILE' AND state IN('OPEN','CLAIMED')) AS unknown`)).rows[0],reporting:(await c.query<{type:string;state:string;timeliness:string;n:number}>('SELECT type,state,resolved_timeliness AS timeliness,count(*)::int n FROM lumbung.evidence_obligations GROUP BY type,state,resolved_timeliness ORDER BY type,state')).rows,
 metrics:(await c.query<{delivered:number;accepted:number;partial:number;refused:number;events:number;people:number;actions:number;median:string|null;p90:string|null}>(`SELECT
 (SELECT count(*)::int FROM lumbung.offers WHERE delivery_receipt_at IS NOT NULL AND r_exclusion IS NULL) delivered,
 (SELECT count(*)::int FROM lumbung.offers WHERE response_kind='ACCEPT' AND delivery_receipt_at IS NOT NULL AND r_exclusion IS NULL) accepted,
 (SELECT count(*)::int FROM lumbung.offers WHERE response_kind='PARTIAL_ACCEPT' AND delivery_receipt_at IS NOT NULL AND r_exclusion IS NULL) partial,
 (SELECT count(*)::int FROM lumbung.offers WHERE decline_reason_code='FEE_UNAFFORDABLE') refused,
 (SELECT count(*)::int FROM lumbung.distribution_events WHERE NOT planned) events,
 (SELECT coalesce(sum(people_reported),0)::int FROM lumbung.distribution_events WHERE NOT planned) people,
 (SELECT count(*)::int FROM lumbung.audit_events WHERE actor_kind='USER') actions,
 (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM ap.approved_at-o.created_at)/60) FROM lumbung.approvals ap JOIN lumbung.allocations a ON a.id=ap.subject_id JOIN lumbung.donation_items i ON i.id=a.item_id JOIN lumbung.donation_orders o ON o.id=i.order_id WHERE ap.stage='FINAL_DISPATCH')::text median,
 (SELECT percentile_cont(0.9) WITHIN GROUP(ORDER BY extract(epoch FROM ap.approved_at-o.created_at)/60) FROM lumbung.approvals ap JOIN lumbung.allocations a ON a.id=ap.subject_id JOIN lumbung.donation_items i ON i.id=a.item_id JOIN lumbung.donation_orders o ON o.id=i.order_id WHERE ap.stage='FINAL_DISPATCH')::text p90`)).rows[0],
 run:(await c.query<{id:string;result:Plan;category:string;from_date:string;to_date:string}>("SELECT id,result,feature_snapshot->>'category' category,feature_snapshot->>'from_date' from_date,feature_snapshot->>'to_date_excl' to_date FROM lumbung.allocation_runs ORDER BY created_at DESC LIMIT 1")).rows[0]}));const rows=data.run?[...data.run.result.selected,...data.run.result.alternatives]:[];const comparable=rows.filter(c=>c.coverage!==null);const jain=jainDiagnostic(comparable.map(c=>c.coverage!));return <>
 <Section id="operations-counts" title={t('metrics')}><div className="direct-grid">{[['/persediaan',id?'Barang masuk dalam 24 jam / terlambat':'Inbound within 24 hours / overdue',data.counts.inbound],['/persediaan',id?'Batch dekat / lewat batas keamanan':'Batches near / past safety deadline',data.counts.near],['/pelaporan',id?'Laporan terlambat':'Overdue reports',data.counts.overdue],['/pengiriman',id?'Pengiriman diterima':'Deliveries received',data.counts.physical],['/pelaporan',id?'Bukti menunggu tinjauan':'Evidence awaiting review',data.counts.review],['/pesan',id?'Hasil kirim pesan belum pasti':'Uncertain message delivery',data.counts.unknown]].map(([href,label,count])=><p className="direct-card" key={String(label)}><Link className="direct-link" href={String(href)}>{label}</Link><strong className="record-quantity">{count}</strong></p>)}</div>
 <h3 className="text-title-3">{id?'Penawaran dan respons':'Offers and responses'}</h3>
 <dl className="metrics-grid">{[
   [id?'Terkirim ke FLO':'Delivered to FLO',data.metrics.delivered],
   [id?'Diterima penuh':'Accepted in full',data.metrics.accepted],
   [id?'Diterima sebagian':'Partially accepted',data.metrics.partial],
   [id?'Ongkir ditolak':'Delivery fee refused',data.metrics.refused],
 ].map(([label,value])=><div className="metric-tile" key={String(label)}><dt>{label}</dt><dd>{Number(value).toLocaleString(id?'id-ID':'en-GB')}</dd></div>)}</dl>
 <details className="record-more"><summary>{id?'Waktu proses dan aktivitas':'Processing time and activity'}</summary>
 <p className="text-caption">{id?'Waktu dari pencatatan donasi hingga persetujuan akhir pengiriman. Median adalah nilai tengah; p90 adalah batas waktu untuk 90% persetujuan yang tercatat.':'Time from donation intake to final dispatch approval. Median is the middle value; p90 is the time within which 90% of recorded approvals were completed.'}</p>
 <dl className="metrics-grid">{[
   [id?'Waktu tengah (median)':'Median time',data.metrics.median==null?'—':Number(data.metrics.median).toLocaleString(id?'id-ID':'en-GB',{maximumFractionDigits:1}),id?'menit':'min'],
   [id?'Waktu p90':'p90 time',data.metrics.p90==null?'—':Number(data.metrics.p90).toLocaleString(id?'id-ID':'en-GB',{maximumFractionDigits:1}),id?'menit':'min'],
   [id?'Aksi operator':'Operator actions',data.metrics.actions.toLocaleString(id?'id-ID':'en-GB'),''],
   [id?'Pembagian tercatat':'Recorded distributions',data.metrics.events.toLocaleString(id?'id-ID':'en-GB'),''],
   [id?'Orang dilaporkan':'Reported people',data.metrics.people.toLocaleString(id?'id-ID':'en-GB'),''],
 ].map(([label,value,unit])=><div className="metric-tile" key={label}><dt>{label}</dt><dd>{value} <small>{unit}</small></dd></div>)}</dl>
 <p className="text-caption">{t('reportedPeople')}. {id?'Orang yang sama dapat terhitung pada beberapa acara.':'The same person may be counted at more than one event.'}</p></details>
 <p className="text-caption">{id?'Data simulasi tidak membuktikan peningkatan terhadap baseline operasi.':'Synthetic results do not establish an improvement over an operational baseline.'}</p>
 <details className="record-more"><summary>{t('reporting')}</summary><div className="table-scroll"><table className="ops-table"><thead><tr><th>{id?'Jenis bukti':'Evidence type'}</th><th>{t('status')}</th><th>{id?'Ketepatan waktu':'Timeliness'}</th><th>{t('total')}</th></tr></thead><tbody>{data.reporting.map((r,i)=><tr key={i}><td>{codeLabel(r.type,locale)}</td><td><StatusBadge code={r.state} locale={locale}/></td><td>{r.timeliness?codeLabel(r.timeliness,locale):'—'}</td><td>{r.n}</td></tr>)}</tbody></table></div></details></Section>
 {data.run&&<Section id="fairness" title={id?'Diagnostik pemerataan kategori':'Category fairness diagnostic'}><p>{data.run.category} · {data.run.from_date} → {data.run.to_date}</p><p>Jain: {jain.status==='OK'?jain.index.toFixed(3):jain.status} · n={jain.n} · {id?'data tidak lengkap':'incomplete data'}: {rows.length-comparable.length} · {id?'tidak memenuhi syarat':'ineligible'}: {data.run.result.excluded.length}</p><p>{id?'Rata-rata cakupan terbatas':'Mean capped coverage'}: {comparable.length?(100*comparable.reduce((sum,c)=>sum+Math.min(1,c.coverage!),0)/comparable.length).toFixed(1)+'%':'—'}</p><Link className="direct-link" href={`/rekomendasi/${data.run.id}`}>{id?'Kohort, faktor, riwayat dan pengecualian':'Cohort, factors, history and exclusions'} →</Link></Section>}
 <Section id="tasks" title={`${t('tasks')} (${data.tasks.length})`}>{data.tasks.map(task=><details key={task.id} className="direct-card"><summary>{codeLabel(task.severity,locale)} · {codeLabel(task.kind,locale)}</summary><p className="record-reference">{id?'Referensi':'Reference'}: {task.subject_id}</p>{['users.manage','reservation.release','inventory.adjust.approve','evidence.review','agreement.review'].some(can)&&<CommandForm url={`/api/tasks/${task.id}/resolve`} label="resolve" fields={[reason]}/>}</details>)}{!data.tasks.length&&<p>{t('empty')}</p>}</Section></>;}
