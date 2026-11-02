'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useLocale, useT } from '@/src/i18n/client';
import { CommandStatus, fieldError } from './CommandStatus';
import { useCommand } from './useCommand';

export interface ProfileValues {
  name: string;
  flo_type: 'PANTI' | 'NON_PANTI';
  service_model: string;
  status: 'ACTIVE' | 'PAUSED';
  address: string | null;
  area: string;
  lat: string | null;
  lng: string | null;
  location_confidence: string;
  cooking_capable: boolean;
  halal_required: boolean;
}

const AREAS = ['JAKARTA', 'BOGOR', 'DEPOK', 'TANGERANG', 'BEKASI'] as const;
const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED'] as const;

/** Revision-guarded profile edit (PATCH /api/flos/[id]); only changed fields are sent. */
export function FloProfileForm({
  floId,
  revision,
  initial,
  canEdit,
}: {
  floId: string;
  revision: number;
  initial: ProfileValues;
  canEdit: boolean;
}) {
  const t = useT('flo');
  const locale = useLocale();
  const cmd = useCommand<{ revision: number; changed: string[] }>();
  const [v, setV] = useState<ProfileValues>(initial);
  const fe = cmd.error?.fieldErrors;
  const set = <K extends keyof ProfileValues>(k: K, value: ProfileValues[K]) => setV((s) => ({ ...s, [k]: value }));

  const patch: Record<string, unknown> = {};
  if (v.name.trim() !== initial.name) patch.name = v.name.trim();
  if (v.flo_type !== initial.flo_type) patch.flo_type = v.flo_type;
  if (v.service_model.trim() !== initial.service_model) patch.service_model = v.service_model.trim();
  if (v.status !== initial.status) patch.status = v.status;
  if ((v.address ?? '').trim() !== (initial.address ?? '')) patch.address = (v.address ?? '').trim() || null;
  if (v.area !== initial.area) patch.area = v.area;
  const latChanged = (v.lat ?? '') !== (initial.lat ?? '') || (v.lng ?? '') !== (initial.lng ?? '');
  if (latChanged) {
    patch.lat = v.lat?.trim() ? Number(v.lat.replace(',', '.')) : null;
    patch.lng = v.lng?.trim() ? Number(v.lng.replace(',', '.')) : null;
  }
  if (v.location_confidence !== initial.location_confidence) patch.location_confidence = v.location_confidence;
  if (v.cooking_capable !== initial.cooking_capable) patch.cooking_capable = v.cooking_capable;
  if (v.halal_required !== initial.halal_required) patch.halal_required = v.halal_required;
  const dirty = Object.keys(patch).length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    await cmd.run(`/api/flos/${floId}`, 'PATCH', { expected_revision: revision, patch });
  }

  return (
    <form onSubmit={onSubmit} className="glass-card-nested p-4 flex flex-col gap-3 min-w-0" noValidate>
      <h3 className="text-title-2">{t('edit.title')}</h3>
      <p className="text-caption">{t('edit.note', { rev: revision })}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id={`p-name-${floId}`} label={t('create.name')} required locale={locale} error={fieldError(fe, 'patch.name')}>
          <input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField id={`p-model-${floId}`} label={t('profile.serviceModel')} locale={locale} error={fieldError(fe, 'patch.service_model')}>
          <input className="input" value={v.service_model} onChange={(e) => set('service_model', e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField id={`p-type-${floId}`} label={t('create.type')} locale={locale}>
          <select className="input" value={v.flo_type} onChange={(e) => set('flo_type', e.target.value as ProfileValues['flo_type'])} disabled={!canEdit}>
            <option value="PANTI">{t('type.PANTI')}</option>
            <option value="NON_PANTI">{t('type.NON_PANTI')}</option>
          </select>
        </FormField>
        <FormField id={`p-status-${floId}`} label={t('profile.status')} locale={locale}>
          <select className="input" value={v.status} onChange={(e) => set('status', e.target.value as ProfileValues['status'])} disabled={!canEdit}>
            <option value="ACTIVE">{t('status.ACTIVE')}</option>
            <option value="PAUSED">{t('status.PAUSED')}</option>
          </select>
        </FormField>
        <FormField id={`p-area-${floId}`} label={t('create.area')} locale={locale}>
          <select className="input" value={v.area} onChange={(e) => set('area', e.target.value)} disabled={!canEdit}>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {t(`area.${a}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id={`p-conf-${floId}`} label={t('profile.locationConfidence')} hint={t('edit.coordsNote')} locale={locale}>
          <select className="input" value={v.location_confidence} onChange={(e) => set('location_confidence', e.target.value)} disabled={!canEdit}>
            {CONFIDENCES.map((c) => (
              <option key={c} value={c}>
                {t(`loc.${c}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id={`p-lat-${floId}`} label="Lat" locale={locale} error={fieldError(fe, 'patch.lat')}>
          <input className="input" inputMode="decimal" value={v.lat ?? ''} onChange={(e) => set('lat', e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField id={`p-lng-${floId}`} label="Lng" locale={locale} error={fieldError(fe, 'patch.lng')}>
          <input className="input" inputMode="decimal" value={v.lng ?? ''} onChange={(e) => set('lng', e.target.value)} disabled={!canEdit} />
        </FormField>
      </div>
      <FormField id={`p-addr-${floId}`} label={t('profile.address')} locale={locale} error={fieldError(fe, 'patch.address')}>
        <input className="input" value={v.address ?? ''} onChange={(e) => set('address', e.target.value)} disabled={!canEdit} />
      </FormField>
      <div className="flex flex-wrap gap-4 text-body">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={v.cooking_capable} onChange={(e) => set('cooking_capable', e.target.checked)} disabled={!canEdit} />
          {t('profile.cooking')}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={v.halal_required} onChange={(e) => set('halal_required', e.target.checked)} disabled={!canEdit} />
          {t('profile.halal')}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={cmd.pending} disabledReason={!canEdit ? t('edit.disabled') : !dirty ? t('edit.nothing') : null}>
          {cmd.pending ? t('action.saving') : t('edit.submit')}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.result && <CommandStatus tone="ok" text={t('edit.saved', { rev: cmd.result.revision })} />}
    </form>
  );
}
