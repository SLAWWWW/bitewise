'use client';

import {Upload} from '@/components/operations/EvidenceForm';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useLocale, useT } from '@/src/i18n/client';
import {
  END_DATE_INTERPRETATIONS,
  lastValidDateFromDocument,
  type EndDateInterpretation,
} from '@/src/domain/flo/agreement-interval';
import { addLocalDays, formatLocalDate } from '@/src/lib/tz';
import { CommandStatus, fieldError } from './CommandStatus';
import { useCommand } from './useCommand';

/**
 * Submit a new agreement version: metadata + local legal dates (WIB). The end date is
 * entered exactly as written in the document together with how it is worded (inclusive
 * "berlaku sampai dengan" vs exclusive "berakhir"); there is no default, so the reviewer
 * sees the interpretation that was chosen (PRD §5). The private uploader
 * registers the document before this form references it.
 */
export function AgreementUploadForm({ floId, canUpload }: { floId: string; canUpload: boolean }) {
  const t = useT('flo');
  const locale = useLocale();
  const cmd = useCommand<{ agreement: { version: number } }>();
  const [signed, setSigned] = useState('');
  const [from, setFrom] = useState('');
  const [endDate, setEndDate] = useState('');
  const [interp, setInterp] = useState<EndDateInterpretation | ''>('');
  const [note, setNote] = useState('');
  const [media, setMedia] = useState('');
  const fe = cmd.error?.fieldErrors;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      flo_id: floId,
      valid_from_date: from,
      document_end_date: endDate,
      end_date_interpretation: interp,
    };
    if (note.trim()) body.interpretation_note = note.trim();
    if (signed) body.signed_date = signed;
    if (media.trim()) body.document_media_id = media.trim();
    const res = await cmd.run('/api/agreements', 'POST', body);
    if (res) {
      setSigned('');
      setFrom('');
      setEndDate('');
      setInterp('');
      setNote('');
      setMedia('');
    }
  }

  const missing = !from || !endDate;
  const lastDay = endDate && interp ? lastValidDateFromDocument(endDate, interp) : null;
  return (
    <>{canUpload&&<Upload subject={floId} purpose="AGREEMENT" onUploaded={setMedia}/>}<form onSubmit={onSubmit} className="glass-card-nested p-4 flex flex-col gap-3 min-w-0" noValidate>
      <h3 className="text-title-2">{t('upload.title')}</h3>
      <p className="text-caption">{t('upload.note')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField id={`ag-from-${floId}`} label={t('upload.from')} required locale={locale} error={fieldError(fe, 'valid_from_date')}>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!canUpload} />
        </FormField>
        <FormField
          id={`ag-end-${floId}`}
          label={t('upload.endDate')}
          hint={t('upload.endDateHint')}
          required
          locale={locale}
          error={fieldError(fe, 'document_end_date')}
        >
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!canUpload} />
        </FormField>
        <FormField id={`ag-signed-${floId}`} label={t('upload.signed')} locale={locale} error={fieldError(fe, 'signed_date')}>
          <input className="input" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} disabled={!canUpload} />
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2 min-w-0" disabled={!canUpload} aria-describedby={`ag-interp-${floId}-hint`}>
        <legend className="form-label">
          {t('upload.interpretation')} <span aria-hidden="true">*</span>
        </legend>
        <p id={`ag-interp-${floId}-hint`} className="text-caption">
          {t('upload.interpretationHint')}
        </p>
        {END_DATE_INTERPRETATIONS.map((v) => (
          <label key={v} className="flex items-start gap-2">
            <input
              type="radio"
              name={`ag-interp-${floId}`}
              value={v}
              checked={interp === v}
              onChange={() => setInterp(v)}
              required
            />
            <span>{t(`upload.interp.${v}`)}</span>
          </label>
        ))}
        {fieldError(fe, 'end_date_interpretation') && (
          <p role="alert" className="lb-field-error">
            {fieldError(fe, 'end_date_interpretation')}
          </p>
        )}
        {lastDay && from && lastDay >= from && (
          <p className="text-caption" aria-live="polite">
            {t('upload.derived', {
              through: formatLocalDate(lastDay, locale),
              end: formatLocalDate(addLocalDays(lastDay, 1), locale),
            })}
          </p>
        )}
      </fieldset>
      <FormField
        id={`ag-note-${floId}`}
        label={t('upload.note2')}
        hint={t('upload.note2Hint')}
        locale={locale}
        error={fieldError(fe, 'interpretation_note')}
      >
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={!canUpload} />
      </FormField>
      {media&&<p className="text-caption">{t('upload.media')}: ✓</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={cmd.pending}
          disabledReason={
            !canUpload
              ? t('rev.needCap', { cap: 'agreement.upload' })
              : missing
                ? t('upload.needDates')
                : !interp
                  ? t('upload.needInterpretation')
                  : null
          }
        >
          {cmd.pending ? t('action.saving') : t('upload.submit')}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.result && <CommandStatus tone="ok" text={t('rev.uploaded')} />}
    </form></>
  );
}
