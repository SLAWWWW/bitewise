import Link from 'next/link';
import { Section } from '@/app/(ops)/ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';

export async function OperationsQueue(){
  const {tx,locale}=await directPage();
  const id=locale==='id';
  const data=await tx(async c=>{
    const counts=(await c.query<{intake:number;outreach:number;final:number;pickup:number}>(`SELECT
      (SELECT count(*)::int FROM lumbung.donation_orders WHERE route='DIRECT' AND operational_state IN('DRAFT','NEEDS_INFO','SAFETY_REVIEW')) AS intake,
      (SELECT count(*)::int FROM lumbung.outreach_campaigns WHERE source_type='DIRECT_ITEM' AND state='AWAITING_APPROVAL') AS outreach,
      (SELECT count(*)::int FROM lumbung.allocations WHERE source_type='DIRECT_ITEM' AND state='AWAITING_FINAL_APPROVAL') AS final,
      (SELECT count(*)::int FROM lumbung.deliveries WHERE route='DIRECT' AND state='READY_FOR_PICKUP' AND planned_pickup_at<=lumbung.tenant_now()+interval '1 hour') AS pickup`)).rows[0];
    const tasks=(await c.query<{id:string;kind:string;reason:string|null;href:string|null}>(`SELECT tk.id,tk.kind,tk.payload->>'reason' AS reason,
      CASE WHEN d.id IS NOT NULL THEN '/pengiriman/'||d.id ELSE '/donasi/'||i.order_id END AS href
      FROM lumbung.tasks tk LEFT JOIN lumbung.deliveries d ON tk.subject_type='DELIVERY' AND d.id=tk.subject_id
      LEFT JOIN lumbung.outbox b ON tk.subject_type='OUTBOX' AND b.id=tk.subject_id
      LEFT JOIN lumbung.offers f ON f.id::text=b.payload->>'offer_id'
      LEFT JOIN lumbung.allocations a ON a.id=CASE WHEN tk.subject_type='ALLOCATION' THEN tk.subject_id ELSE f.allocation_id END
      LEFT JOIN lumbung.donation_items i ON i.id=a.item_id
      WHERE tk.state IN('OPEN','CLAIMED') AND tk.kind IN('REMATCH_REQUIRED','LOGISTICS_REVIEW','SEND_RECONCILE','CHANNEL_FAILURE',
        'RECEIPT_DISCREPANCY','AGREEMENT_REVOKED_ACTIVE_COMMITMENT','JOB_TERMINAL_FAILURE') ORDER BY tk.created_at DESC,tk.id LIMIT 12`)).rows;
    return {counts,tasks};
  });
  const tiles=[
    ['/donasi',id?'Donasi perlu informasi / validasi':'Donations needing details / validation',data.counts.intake],
    ['/persetujuan',id?'Menunggu persetujuan outreach':'Awaiting outreach approval',data.counts.outreach],
    ['/persetujuan',id?'Menunggu persetujuan pengiriman':'Awaiting dispatch approval',data.counts.final],
    ['/pengiriman',id?'Pengambilan dalam 1 jam / terlambat':'Pickup within an hour / overdue',data.counts.pickup],
  ] as const;
  const labels:Record<string,string>={REMATCH_REQUIRED:id?'Perlu pencocokan ulang':'Rematching needed',LOGISTICS_REVIEW:id?'Ongkir ditolak FLO':'Delivery fee refused',
    SEND_RECONCILE:id?'Status pesan perlu diperiksa':'Reconcile message outcome',CHANNEL_FAILURE:id?'Pesan gagal dikirim':'Message send failed',
    RECEIPT_DISCREPANCY:id?'Selisih penerimaan':'Receipt discrepancy',AGREEMENT_REVOKED_ACTIVE_COMMITMENT:id?'Perjanjian dicabut; alokasi dihentikan':'Agreement revoked; allocation stopped',
    JOB_TERMINAL_FAILURE:id?'Antrean perlu penanganan staf':'Job needs operator review'};
  return <Section id="direct-operations" title={id?'Operasi donasi langsung':'Direct donation operations'}>
    <div className="direct-grid">{tiles.map(([href,label,n])=><Link data-tour="queue-link" className="direct-card direct-link" href={href} key={label}><span>{label}</span><strong className="text-title-2">{n}</strong></Link>)}</div>
    {data.tasks.length>0&&<ul className="direct-stack">{data.tasks.map(task=><li key={task.id}>{task.href?<Link className="direct-link" href={task.href}>{labels[task.kind]??task.kind}</Link>:<span>{labels[task.kind]??task.kind}</span>}</li>)}</ul>}
  </Section>;
}
