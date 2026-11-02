'use client';
import { cloneElement, isValidElement, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useCommand } from '@/components/flo/useCommand';
import { useT } from '@/src/i18n/client';
import type { Allocation, Delivery, IntakeReferences, Offer } from '@/src/application/direct/queries';
import {formatQty,parseDbQty} from '@/src/lib/qty';
import type { Plan } from '@/src/domain/allocation/planner';

export function localInput(instant: string, hours = 0) { return new Date(Date.parse(instant) + (7 + hours) * 3600000).toISOString().slice(0,16); }
function instant(value: FormDataEntryValue | null) { return `${String(value)}:00+07:00`; }
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id=useId();
  return <div className="direct-field"><label htmlFor={id}>{label}</label>{isValidElement<{id?:string}>(children)?cloneElement(children,{id}):children}</div>;
}
function Status({ error, result }: { error: { code: string; message: string } | null; result: unknown }) {
  const t = useT('direct');
  return error ? <p role="alert" className="direct-error">{error.code}: {error.message}</p> : result ? <p role="status">{t('saved')}</p> : null;
}
export function CommandAction({ url, label, body, allowed = true, reason = false, reasonLabel, navigatePrefix }: {
  url: string; label: string; body: Record<string, unknown>; allowed?: boolean; reason?: boolean; reasonLabel?: string; navigatePrefix?: string;
}) {
  const t = useT('direct'); const cmd = useCommand<{ id: string }>(); const router = useRouter();
  return <form className="direct-command" onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const res = await cmd.run(url,'POST',reason ? { ...body, reason: String(data.get('reason')) } : body);
    if (res && navigatePrefix) router.push(`${navigatePrefix}/${res.id}`);
  }}>
    {reason && <Field label={reasonLabel??t('approvalReason')}><input name="reason" required minLength={3} maxLength={1000} disabled={!allowed} /></Field>}
    <Button type="submit" loading={cmd.pending} disabledReason={allowed ? null : t('permission')}>{label}</Button>
    <Status {...cmd} />
  </form>;
}
export function IntakeForm({ refs }: { refs: IntakeReferences }) {
  const t = useT('direct'); const cmd = useCommand<{ id: string }>(); const router = useRouter();
  const [donor, setDonor] = useState(refs.donors[0]?.id ?? '');
  const [productId, setProduct] = useState(refs.products.find(p=>p.code==='ROTI-TAWAR')?.id ?? refs.products[0]?.id ?? '');
  const product = refs.products.find(p=>p.id===productId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const result = await cmd.run('/api/donations','POST', {
      donor_id: donor, source_location_id: f.get('source'), donation_reason: 'SURPLUS', pickup_start: instant(f.get('pickup_start')), pickup_end: instant(f.get('pickup_end')),
      items: [{ product_id: productId, quantity: String(f.get('quantity')), unit: product?.base_unit, condition: f.get('condition'), ...(f.get('weight_kg')?{[f.get('weight_type')==='MEASURED'?'measured_weight_kg':'est_weight_kg']:String(f.get('weight_kg')),weight_provenance:f.get('weight_type')}:{}),distribute_by: instant(f.get('distribute_by')),
        prep_info: { ...(f.get('ready_at') ? { ready_at: instant(f.get('ready_at')) } : {}), handling_confirmed: f.get('handling')==='on' },
        label_info: f.get('expiry_at') ? { expiry_at: instant(f.get('expiry_at')) } : {} }],
    });
    if (result) router.push(`/donasi/${result.id}`);
  }
  return <form onSubmit={submit} className="direct-form">
    <Field label={t('donor')}><select value={donor} onChange={e=>setDonor(e.target.value)}>{refs.donors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    <Field label={t('source')}><select name="source" key={donor}>{refs.sources.filter(s=>s.donor_id===donor).map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
    <Field label={t('product')}><select value={productId} onChange={e=>setProduct(e.target.value)}>{refs.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label={`${t('quantity')} (${product?.base_unit})`}><input name="quantity" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,3})?" defaultValue="120" required /></Field>
    <Field label={t('weight')}><input name="weight_kg" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,3})?"/></Field><Field label={t('weightType')}><select name="weight_type"><option value="ESTIMATED">{t('estimated')}</option><option value="MEASURED">{t('measured')}</option></select></Field>
    <Field label={t('condition')}><select name="condition"><option value="GOOD">{t('good')}</option><option value="UNKNOWN">{t('unknown')}</option><option value="OUTER_PACKAGING_DAMAGE">OUTER_PACKAGING_DAMAGE</option><option value="INNER_SEAL_DAMAGED">INNER_SEAL_DAMAGED</option></select></Field>
    <Field label={t('pickupStart')}><input name="pickup_start" type="datetime-local" required defaultValue={localInput(refs.now)} /></Field>
    <Field label={t('pickupEnd')}><input name="pickup_end" type="datetime-local" required defaultValue={localInput(refs.now,3)} /></Field>
    <Field label={t('distributeBy')}><input name="distribute_by" type="datetime-local" required defaultValue={localInput(refs.now,6)} /></Field>
    <Field label={t('readyAt')}><input name="ready_at" type="datetime-local" defaultValue={localInput(refs.now)} /></Field>
    <Field label={t('expiryAt')}><input name="expiry_at" type="datetime-local" /></Field>
    <label className="direct-checkbox"><input name="handling" type="checkbox" />{t('handling')}</label>
    <div><Button type="submit" loading={cmd.pending}>{t('create')}</Button><Status {...cmd} /></div>
  </form>;
}
export function PlanForm({ itemId, now, allowed }: { itemId: string; now: string; allowed: boolean }) {
  const t = useT('direct'); const cmd = useCommand<{ id: string }>(); const router = useRouter();
  return <form className="direct-form" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const r=await cmd.run('/api/allocation-runs','POST',{item_id:itemId,receipt_at:instant(f.get('receipt')),distribution_at:instant(f.get('distribution'))});
    if(r)router.push(`/rekomendasi/${r.id}`);
  }}>
    <Field label={t('receiptAt')}><input name="receipt" type="datetime-local" required defaultValue={localInput(now,1)} /></Field>
    <Field label={t('distributionAt')}><input name="distribution" type="datetime-local" required defaultValue={localInput(now,2)} /></Field>
    <div><Button type="submit" loading={cmd.pending} disabledReason={allowed?null:t('permission')}>{t('plan')}</Button><Status {...cmd}/></div>
  </form>;
}
export function PlanChoiceForm({runId,orderId,plan,unit,allowed}:{runId:string;orderId:string|null;plan:Plan;unit:string;allowed:boolean}) {
  const t=useT('direct');const cmd=useCommand();
  const candidates=[...plan.selected,...plan.alternatives];
  return <form className="direct-command" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const lines=candidates.filter(c=>f.get(`select-${c.flo_id}`)==='on').map(c=>({flo_id:c.flo_id,quantity:String(f.get(`qty-${c.flo_id}`))}));
    await cmd.run('/api/campaigns','POST',{run_id:runId,lines,reason:String(f.get('reason'))},{navigateTo:orderId?`/donasi/${orderId}`:'/persetujuan'});
  }}>
    <div className="direct-grid" style={{width:'100%'}}>{candidates.map(c=><div className="direct-card" key={c.flo_id}>
      <label className="direct-checkbox"><input type="checkbox" name={`select-${c.flo_id}`} defaultChecked={plan.selected.some(s=>s.flo_id===c.flo_id)}/>{c.code} · {c.name}</label>
      <Field label={`${t('quantity')} (${unit})`}><input name={`qty-${c.flo_id}`} inputMode="decimal" defaultValue={plan.selected.find(s=>s.flo_id===c.flo_id)?.quantity??c.capacity}/></Field>
    </div>)}</div>
    <Field label={t('approvalReason')}><input name="reason" required minLength={3} maxLength={1000}/></Field>
    <Button type="submit" loading={cmd.pending} disabledReason={allowed?null:t('permission')}>{t('draft')}</Button><Status {...cmd}/>
  </form>;
}
export function OfferResponse({ offer, allowed }: { offer: Offer; allowed: boolean }) {
  const t=useT('direct');const cmd=useCommand();const [response,setResponse]=useState('ACCEPT');
  return <form className="direct-form" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);await cmd.run(`/api/offers/${offer.id}/respond`,'POST',{
      expected_revision:offer.revision,response,...(response==='DECLINE'?{reason:f.get('decline_reason')}:{quantity:response==='ACCEPT'?offer.quantity:String(f.get('quantity'))})});
  }}>
    <Field label={t('response')}><select value={response} onChange={e=>setResponse(e.target.value)}><option value="ACCEPT">{t('accept')}</option><option value="PARTIAL_ACCEPT">{t('partial')}</option><option value="DECLINE">{t('decline')}</option></select></Field>
    {response==='PARTIAL_ACCEPT'&&<Field label={`${t('quantity')} (${offer.unit})`}><input name="quantity" inputMode="decimal" required defaultValue={offer.quantity}/></Field>}
    {response==='DECLINE'&&<Field label={t('reason')}><select name="decline_reason">{[['FEE_UNAFFORDABLE','feeUnaffordable'],['TIMING','timing'],['DIET','diet'],['SUITABILITY','suitability'],['OTHER','other']].map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select></Field>}
    <div><Button type="submit" loading={cmd.pending} disabledReason={allowed?null:t('permission')}>{t('sendResponse')}</Button><Status {...cmd}/></div>
  </form>;
}
export function TransportForm({ allocation:a, allowed }: { allocation:Allocation; allowed:boolean }) {
  const t=useT('direct');const cmd=useCommand();const [method,setMethod]=useState(a.transport_method??'SELF_PICKUP');
  return <form className="direct-form" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);await cmd.run(`/api/allocations/${a.id}/transport`,'POST',{
      expected_revision:a.revision,method,decision:method==='SELF_PICKUP'?'ACCEPT':String(f.get('decision')),contact_id:a.contact_id,
      arranger:String(f.get('arranger')),fee_idr:method==='SELF_PICKUP'?null:Number(f.get('fee'))});
  }}>
    <Field label={t('method')}><select value={method} onChange={e=>setMethod(e.target.value)}><option value="SELF_PICKUP">{t('selfPickup')}</option><option value="FLO_BOOKED_COURIER">{t('floCourier')}</option><option value="FOODCYCLE_COORDINATED_COURIER">{t('coordinated')}</option></select></Field>
    <Field label={t('arranger')}><input name="arranger" required minLength={3}/></Field>
    {method!=='SELF_PICKUP'&&<><Field label={t('fee')}><input name="fee" type="number" min="0" step="1" required defaultValue={a.fee_idr??''}/></Field>
    <Field label={t('feeDecision')}><select name="decision"><option value="ACCEPT">{t('feeAccept')}</option><option value="REFUSE">{t('feeRefuse')}</option></select></Field></>}
    <div><Button type="submit" loading={cmd.pending} disabledReason={allowed&&a.contact_id?null:t('permission')}>{t('saveTransport')}</Button><Status {...cmd}/></div>
  </form>;
}
export function DeliveryActions({ delivery:d, dispatchAllowed, receiveAllowed }: { delivery:Delivery; dispatchAllowed:boolean; receiveAllowed:boolean }) {
  const t=useT('direct');const cmd=useCommand();const receiving=d.state==='IN_TRANSIT';
  return <form className="direct-form" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);await cmd.run(`/api/deliveries/${d.id}/${receiving?'receive':'dispatch'}`,'POST',{
      expected_revision:d.revision,...(receiving?{accepted_quantity:String(f.get('accepted')),rejected_quantity:String(f.get('rejected')),reason:String(f.get('reason'))}:{custodian:String(f.get('custodian'))})});
  }}>
    {receiving?<><Field label={`${t('accepted')} (${d.lines[0]?.unit})`}><input name="accepted" inputMode="decimal" required defaultValue={formatQty(d.lines.reduce((total,line)=>total+parseDbQty(line.dispatched_qty??'0'),0n))}/></Field>
    <Field label={t('rejected')}><input name="rejected" inputMode="decimal" required defaultValue="0"/></Field><Field label={t('reason')}><input name="reason" maxLength={1000}/></Field></>:
    <Field label={t('custodian')}><input name="custodian" required minLength={3}/></Field>}
    <div><Button type="submit" loading={cmd.pending} disabledReason={(receiving?receiveAllowed:dispatchAllowed)?null:t('permission')}>{t(receiving?'receive':'dispatch')}</Button><Status {...cmd}/></div>
  </form>;
}
export function SafetyCorrection({itemId,revision,now,allowed}:{itemId:string;revision:number;now:string;allowed:boolean}) {
  const t=useT('direct');const cmd=useCommand();
  return <form className="direct-form" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);await cmd.run(`/api/donation-items/${itemId}/revise`,'POST',{
      expected_revision:revision,condition:f.get('condition'),reason:String(f.get('reason')),
      prep_info:{...(f.get('ready_at')?{ready_at:instant(f.get('ready_at'))}:{}),handling_confirmed:f.get('handling')==='on'},
      label_info:f.get('expiry_at')?{expiry_at:instant(f.get('expiry_at'))}:{}
    });
  }}>
    <Field label={t('condition')}><select name="condition"><option value="GOOD">{t('good')}</option><option value="UNKNOWN">{t('unknown')}</option></select></Field>
    <Field label={t('readyAt')}><input name="ready_at" type="datetime-local" defaultValue={localInput(now)}/></Field>
    <Field label={t('expiryAt')}><input name="expiry_at" type="datetime-local"/></Field>
    <label className="direct-checkbox"><input name="handling" type="checkbox"/>{t('handling')}</label>
    <Field label={t('reason')}><input name="reason" required minLength={3}/></Field>
    <div><Button type="submit" loading={cmd.pending} disabledReason={allowed?null:t('permission')}>{t('saved').replace('.','')}</Button><Status {...cmd}/></div>
  </form>;
}
