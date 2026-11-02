'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useLocale, useT } from '@/src/i18n/client';
import { CommandStatus, fieldError } from './CommandStatus';
import { useCommand } from './useCommand';

const AREAS = ['JAKARTA', 'BOGOR', 'DEPOK', 'TANGERANG', 'BEKASI'] as const;

/** Draft FLO creation (POST /api/flos). Nothing is verified implicitly. */
export function FloCreateForm({
  clusters,
  canEdit,
}: {
  clusters: { id: string; name: string; area: string }[];
  canEdit: boolean;
}) {
  const t = useT('flo');
  const locale = useLocale();
  const cmd = useCommand<{ flo_id: string; code: string }>();
  const [name, setName] = useState('');
  const [type, setType] = useState<'PANTI' | 'NON_PANTI'>('PANTI');
  const [model, setModel] = useState('');
  const [area, setArea] = useState<(typeof AREAS)[number]>('JAKARTA');
  const [clusterId, setClusterId] = useState('');
  const [address, setAddress] = useState('');
  const fe = cmd.error?.fieldErrors;
  const areaClusters = clusters.filter((c) => c.area === area);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { name: name.trim(), flo_type: type, service_model: model.trim(), area };
    if (clusterId) body.cluster_id = clusterId;
    if (address.trim()) body.address = address.trim();
    const res = await cmd.run('/api/flos', 'POST', body);
    if (res) {
      setName('');
      setModel('');
      setAddress('');
      setClusterId('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 min-w-0" noValidate>
      <p className="text-caption">{t('create.note')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id="new-flo-name" label={t('create.name')} required locale={locale} error={fieldError(fe, 'name')}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField
          id="new-flo-model"
          label={t('create.serviceModel')}
          hint={t('create.serviceModelHint')}
          required
          locale={locale}
          error={fieldError(fe, 'service_model')}
        >
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField id="new-flo-type" label={t('create.type')} required locale={locale}>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as 'PANTI' | 'NON_PANTI')} disabled={!canEdit}>
            <option value="PANTI">{t('type.PANTI')}</option>
            <option value="NON_PANTI">{t('type.NON_PANTI')}</option>
          </select>
        </FormField>
        <FormField id="new-flo-area" label={t('create.area')} required locale={locale}>
          <select
            className="input"
            value={area}
            onChange={(e) => {
              setArea(e.target.value as (typeof AREAS)[number]);
              setClusterId('');
            }}
            disabled={!canEdit}
          >
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {t(`area.${a}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="new-flo-cluster" label={t('create.cluster')} locale={locale} error={fieldError(fe, 'cluster_id')}>
          <select className="input" value={clusterId} onChange={(e) => setClusterId(e.target.value)} disabled={!canEdit}>
            <option value="">{t('create.noCluster')}</option>
            {areaClusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="new-flo-address" label={t('create.address')} locale={locale} error={fieldError(fe, 'address')}>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit} />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={cmd.pending}
          disabledReason={!canEdit ? t('edit.disabled') : name.trim().length < 3 || model.trim().length < 2 ? t('create.needFields') : null}
        >
          {cmd.pending ? t('action.saving') : t('create.submit')}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.result && (
        <p role="status" className="text-body">
          {t('create.created', { code: cmd.result.code })}{' '}
          <Link className="lb-link" href={`/flo/${cmd.result.flo_id}`}>
            {t('create.open', { code: cmd.result.code })}
          </Link>
        </p>
      )}
    </form>
  );
}
