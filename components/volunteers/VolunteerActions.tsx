'use client';

import { useState, type FormEvent } from 'react';
import { AlertTriangle, Check, MapPin, Play, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCommand } from '@/components/flo/useCommand';
import { useT } from '@/src/i18n/client';
import type { EligibleDelivery, VolunteerProfile, VolunteerRoute } from '@/src/application/volunteers/queries';
import styles from './volunteer.module.css';

type Caps = { claim: boolean; progress: boolean; manage: boolean };

const NEXT_ACTION: Partial<Record<string, { action: string; label: string; icon: typeof Play }>> = {
  CLAIMED: { action: 'start', label: 'start', icon: Play },
  EN_ROUTE_TO_PICKUP: { action: 'arrive-pickup', label: 'arrivePickup', icon: MapPin },
  AT_PICKUP: { action: 'pickup', label: 'confirmPickup', icon: Check },
  PICKED_UP: { action: 'depart-dropoff', label: 'departDropoff', icon: Play },
  EN_ROUTE_TO_DROPOFF: { action: 'arrive-dropoff', label: 'arriveDropoff', icon: MapPin },
  AT_DROPOFF: { action: 'handoff', label: 'handoff', icon: Check },
};

export function RouteActions({ route, currentUserId, caps, volunteers = [] }: {
  route: VolunteerRoute;
  currentUserId: string;
  caps: Caps;
  volunteers?: VolunteerProfile[];
}) {
  const t = useT('volunteer');
  const cmd = useCommand();
  const [note, setNote] = useState('');
  const [failureCode, setFailureCode] = useState('OTHER');
  const mine = route.volunteer_user_id === currentUserId;
  const terminal = ['HANDOFF_RECORDED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(route.display_state);

  async function progress(action: string, extra: Record<string, unknown> = {}) {
    await cmd.run(`/api/volunteer-routes/${route.id}/progress`, 'POST', {
      expected_revision: route.revision,
      action,
      ...extra,
    });
  }

  if (terminal) return null;
  return <div className={styles.actions}>
    {route.state === 'OPEN' && caps.claim && <Button type="button" onClick={() => cmd.run(`/api/volunteer-routes/${route.id}/claim`, 'POST', { expected_revision: route.revision })} loading={cmd.pending}>
      <UserPlus size={16} aria-hidden="true" /> {t('claim')}
    </Button>}
    {mine && caps.progress && NEXT_ACTION[route.state] && (() => {
      const next = NEXT_ACTION[route.state]!;
      const Icon = next.icon;
      return <Button type="button" onClick={() => progress(next.action, next.action === 'handoff' ? { note } : {})} loading={cmd.pending}>
        <Icon size={16} aria-hidden="true" /> {t(next.label)}
      </Button>;
    })()}
    {mine && route.state === 'AT_DROPOFF' && <label className={styles.compactField}><span>{t('handoffNote')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2}/></label>}
    {mine && caps.claim && route.state === 'CLAIMED' && <Button variant="secondary" type="button" onClick={() => progress('release')} loading={cmd.pending}>
      <X size={16} aria-hidden="true" /> {t('release')}
    </Button>}
    {caps.manage && ['OPEN', 'CLAIMED'].includes(route.state) && volunteers.length > 0 && <form className={styles.assignForm} onSubmit={async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await cmd.run(`/api/volunteer-routes/${route.id}/assign`, 'POST', { expected_revision: route.revision, volunteer_user_id: String(data.get('volunteer_user_id')) });
    }}>
      <select name="volunteer_user_id" defaultValue={route.volunteer_user_id ?? volunteers[0].user_id} aria-label={t('volunteer')}>
        {volunteers.filter((volunteer) => volunteer.status === 'ACTIVE').map((volunteer) => <option value={volunteer.user_id} key={volunteer.user_id}>{volunteer.display_name} · {volunteer.vehicle_type}</option>)}
      </select>
      <Button variant="secondary" type="submit" loading={cmd.pending}>{t('assign')}</Button>
    </form>}
    {caps.manage && ['OPEN', 'CLAIMED'].includes(route.state) && <Button variant="secondary" type="button" onClick={() => progress('cancel')} loading={cmd.pending}>
      <X size={16} aria-hidden="true" /> {t('cancel')}
    </Button>}
    {mine && caps.progress && !['OPEN', 'CLAIMED'].includes(route.state) && <details className={styles.problemBox}>
      <summary><AlertTriangle size={15} aria-hidden="true" /> {t('fail')}</summary>
      <label className={styles.compactField}><span>{t('failureCode')}</span><select value={failureCode} onChange={(event) => setFailureCode(event.target.value)}>
        {['NO_SHOW','VEHICLE','FOOD_UNAVAILABLE','SAFETY','ACCESS','OTHER'].map((code) => <option value={code} key={code}>{code.replaceAll('_',' ')}</option>)}
      </select></label>
      <label className={styles.compactField}><span>{t('failureNote')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={1000} rows={3}/></label>
      <Button variant="secondary" type="button" onClick={() => progress('fail', { failure_code: failureCode, note })} loading={cmd.pending}>{t('fail')}</Button>
    </details>}
    {cmd.error && <p role="alert" className="direct-error">{cmd.error.code}: {cmd.error.message}</p>}
  </div>;
}

export function PublishRouteForm({ deliveries, volunteers }: { deliveries: EligibleDelivery[]; volunteers: VolunteerProfile[] }) {
  const t = useT('volunteer');
  const cmd = useCommand();
  if (!deliveries.length) return <p className="text-caption">{t('noAvailable')}</p>;
  return <form className={styles.publishForm} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const volunteer = String(data.get('volunteer_user_id') ?? '');
    await cmd.run('/api/volunteer-routes', 'POST', {
      delivery_id: String(data.get('delivery_id')),
      ...(volunteer ? { volunteer_user_id: volunteer } : {}),
    });
  }}>
    <label className={styles.compactField}><span>{t('publish')}</span><select name="delivery_id">
      {deliveries.map((delivery) => <option value={delivery.id} key={delivery.id}>{delivery.code} · {delivery.source_name} → {delivery.flo_name}</option>)}
    </select></label>
    <label className={styles.compactField}><span>{t('volunteer')}</span><select name="volunteer_user_id" defaultValue="">
      <option value="">{t('unassigned')}</option>
      {volunteers.filter((volunteer) => volunteer.status === 'ACTIVE').map((volunteer) => <option value={volunteer.user_id} key={volunteer.user_id}>{volunteer.display_name} · {volunteer.vehicle_type}</option>)}
    </select></label>
    <Button type="submit" loading={cmd.pending}>{t('publish')}</Button>
    {cmd.error && <p role="alert" className="direct-error">{cmd.error.code}: {cmd.error.message}</p>}
  </form>;
}

export function VolunteerProfileForm({ volunteer }: { volunteer: VolunteerProfile }) {
  const t = useT('volunteer');
  const cmd = useCommand();
  const [days, setDays] = useState<number[]>(volunteer.available_dows);
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return <form className={styles.profileForm} onSubmit={async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await cmd.run(`/api/volunteers/${volunteer.user_id}`, 'POST', {
      status: String(data.get('status')),
      vehicle_type: String(data.get('vehicle_type')),
      max_load_kg: Number(data.get('max_load_kg')),
      refrigerated: data.get('refrigerated') === 'on',
      home_area: String(data.get('home_area')),
      available_dows: days,
      available_start: String(data.get('available_start')).slice(0,5),
      available_end: String(data.get('available_end')).slice(0,5),
      availability_note: String(data.get('availability_note') ?? ''),
    });
  }}>
    <div className={styles.formGrid}>
      <label className={styles.compactField}><span>{t('status')}</span><select name="status" defaultValue={volunteer.status}><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option></select></label>
      <label className={styles.compactField}><span>{t('vehicle')}</span><select name="vehicle_type" defaultValue={volunteer.vehicle_type}>{['BICYCLE','MOTORBIKE','CAR','VAN'].map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label>
      <label className={styles.compactField}><span>{t('capacity')} (kg)</span><input name="max_load_kg" type="number" min="1" max="5000" step="0.1" defaultValue={volunteer.max_load_kg}/></label>
      <label className={styles.checkLine}><input name="refrigerated" type="checkbox" defaultChecked={volunteer.refrigerated}/><span>{t('refrigerated')}</span></label>
      <label className={styles.compactField}><span>{t('homeArea')}</span><input name="home_area" defaultValue={volunteer.home_area} minLength={2} maxLength={120}/></label>
      <label className={styles.compactField}><span>{t('startTime')}</span><input name="available_start" type="time" defaultValue={volunteer.available_start.slice(0,5)}/></label>
      <label className={styles.compactField}><span>{t('endTime')}</span><input name="available_end" type="time" defaultValue={volunteer.available_end.slice(0,5)}/></label>
    </div>
    <fieldset className={styles.dayPicker}><legend>{t('days')}</legend>{dayLabels.map((label,index) => <label key={label}><input type="checkbox" checked={days.includes(index+1)} onChange={(event) => setDays((current) => event.target.checked ? [...current,index+1].sort() : current.filter((day) => day!==index+1))}/><span>{label}</span></label>)}</fieldset>
    <label className={styles.compactField}><span>{t('availabilityNote')}</span><textarea name="availability_note" defaultValue={volunteer.availability_note ?? ''} maxLength={1000} rows={2}/></label>
    <Button type="submit" loading={cmd.pending}>{t('saveProfile')}</Button>
    {cmd.error && <p role="alert" className="direct-error">{cmd.error.code}: {cmd.error.message}</p>}
  </form>;
}
