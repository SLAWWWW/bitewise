'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useLocale, useT } from '@/src/i18n/client';
import { CommandStatus, fieldError } from './CommandStatus';
import { useCommand } from './useCommand';

export interface CategoryOption {
  id: string;
  code: string;
  label: string;
  comparable_unit: string;
}

/**
 * Propose a need assessment (need.propose). With need.confirm the staff member can
 * confirm in the same step ("staff assessed need revision", PRD §19).
 */
export function NeedProposalForm({
  floId,
  categories,
  canPropose,
  canConfirm,
}: {
  floId: string;
  categories: CategoryOption[];
  canPropose: boolean;
  canConfirm: boolean;
}) {
  const t = useT('flo');
  const locale = useLocale();
  const cmd = useCommand<{ status: string }>();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [score, setScore] = useState('');
  const [basis, setBasis] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [intended, setIntended] = useState('');
  const [support, setSupport] = useState('');
  const [validDays, setValidDays] = useState('30');
  const [confirmNow, setConfirmNow] = useState(false);
  const fe = cmd.error?.fieldErrors;
  const unitPlaceholder = categories.find((c) => c.id === categoryId)?.comparable_unit ?? '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      action: 'PROPOSE',
      category_id: categoryId,
      score: Number(score.replace(',', '.')),
      valid_days: Number(validDays),
      confirm: canConfirm && confirmNow,
    };
    if (basis.trim()) body.basis = basis.trim();
    if (qty.trim()) body.requested_qty = qty.trim().replace(',', '.');
    if (unit.trim()) body.unit = unit.trim();
    if (intended) body.intended_distribution_date = intended;
    if (support.trim()) body.existing_support = support.trim();
    const ok = await cmd.run(`/api/flos/${floId}/needs`, 'POST', body);
    if (ok) {
      setScore('');
      setBasis('');
      setQty('');
      setUnit('');
      setIntended('');
      setSupport('');
      setConfirmNow(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass-card-nested p-4 flex flex-col gap-3 min-w-0" noValidate>
      <h3 className="text-title-2">{t('needForm.title')}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id={`need-cat-${floId}`} label={t('needForm.category')} required locale={locale} error={fieldError(fe, 'category_id')}>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canPropose}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id={`need-score-${floId}`}
          label={t('needForm.score')}
          hint={t('needForm.scoreHint')}
          required
          locale={locale}
          error={fieldError(fe, 'score')}
        >
          <input className="input" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} disabled={!canPropose} />
        </FormField>
        <FormField id={`need-qty-${floId}`} label={t('needForm.requestedQty')} locale={locale} error={fieldError(fe, 'requested_qty')}>
          <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!canPropose} />
        </FormField>
        <FormField id={`need-unit-${floId}`} label={t('needForm.unit')} hint={t('needForm.unitHint')} locale={locale} error={fieldError(fe, 'unit')}>
          <input className="input" value={unit} placeholder={unitPlaceholder} onChange={(e) => setUnit(e.target.value)} disabled={!canPropose} />
        </FormField>
        <FormField id={`need-date-${floId}`} label={t('needForm.intended')} locale={locale} error={fieldError(fe, 'intended_distribution_date')}>
          <input className="input" type="date" value={intended} onChange={(e) => setIntended(e.target.value)} disabled={!canPropose} />
        </FormField>
        <FormField id={`need-days-${floId}`} label={t('needForm.validDays')} locale={locale} error={fieldError(fe, 'valid_days')}>
          <input className="input" inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value)} disabled={!canPropose} />
        </FormField>
      </div>
      <FormField id={`need-basis-${floId}`} label={t('needForm.basis')} locale={locale} error={fieldError(fe, 'basis')}>
        <input className="input" value={basis} onChange={(e) => setBasis(e.target.value)} disabled={!canPropose} />
      </FormField>
      <FormField id={`need-support-${floId}`} label={t('needForm.support')} locale={locale} error={fieldError(fe, 'existing_support')}>
        <input className="input" value={support} onChange={(e) => setSupport(e.target.value)} disabled={!canPropose} />
      </FormField>
      {canConfirm && (
        <label className="flex items-start gap-2 text-body">
          <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} className="mt-1" />
          <span>
            {t('needForm.confirmNow')}
            <span className="block text-caption">{t('needForm.confirmNowHint')}</span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={cmd.pending}
          disabledReason={!canPropose ? t('needForm.disabled') : !score.trim() ? t('needForm.needScore') : null}
        >
          {cmd.pending ? t('action.saving') : t('needForm.submit')}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.result && <CommandStatus tone="ok" text={t('needForm.saved')} />}
    </form>
  );
}
