'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useLocale, useT } from '@/src/i18n/client';
import { CommandStatus, fieldError } from './CommandStatus';
import { useCommand } from './useCommand';

/** Approve a PENDING_VERIFICATION version; overlap needs the explicit SUPERSEDE_PREVIOUS resolution. */
export function ApproveAgreementAction({
  floId,
  agreementId,
  version,
  revision,
  overlappingVersions,
  canReview,
}: {
  floId: string;
  agreementId: string;
  version: number;
  revision: number;
  /** Versions of APPROVED agreements whose interval overlaps this one. */
  overlappingVersions: number[];
  canReview: boolean;
}) {
  const t = useT('flo');
  const cmd = useCommand();
  const [supersede, setSupersede] = useState(false);
  const overlap = overlappingVersions.length > 0;
  const reason = !canReview
    ? t('rev.needCap', { cap: 'agreement.review' })
    : overlap && !supersede
      ? t('rev.needSupersede')
      : null;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {overlap && (
        <div className="flex flex-col gap-2">
          <p className="text-body text-[var(--warning)]" role="note">
            {t('rev.overlapWarn', { versions: overlappingVersions.join(', ') })}
          </p>
          <label className="flex items-start gap-2 text-body" htmlFor={`supersede-${agreementId}`}>
            <input
              id={`supersede-${agreementId}`}
              type="checkbox"
              className="mt-1"
              checked={supersede}
              onChange={(e) => setSupersede(e.target.checked)}
              disabled={!canReview}
            />
            <span>{t('rev.supersede')}</span>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          loading={cmd.pending}
          disabledReason={reason}
          onClick={() =>
            cmd.run(
              `/api/agreements/${agreementId}/approve`,
              'POST',
              { expected_revision: revision, overlap_resolution: overlap && supersede ? 'SUPERSEDE_PREVIOUS' : null },
              { navigateTo: `/flo/${floId}/perjanjian?notice=approved&v=${version}` },
            )
          }
        >
          {cmd.pending ? t('action.saving') : t('rev.approve', { v: version })}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.error && fieldError(cmd.error.fieldErrors, 'overlap_resolution') && (
        <CommandStatus tone="error" text={fieldError(cmd.error.fieldErrors, 'overlap_resolution')!} />
      )}
      {cmd.result != null && <CommandStatus tone="ok" text={t('rev.approved')} />}
    </div>
  );
}

/** Revoke an APPROVED version with a mandatory reason. */
export function RevokeAgreementAction({
  floId,
  agreementId,
  version,
  revision,
  canReview,
}: {
  floId: string;
  agreementId: string;
  version: number;
  revision: number;
  canReview: boolean;
}) {
  const t = useT('flo');
  const locale = useLocale();
  const cmd = useCommand();
  const [reason, setReason] = useState('');
  const disabled = !canReview
    ? t('rev.needCap', { cap: 'agreement.review' })
    : reason.trim().length < 3
      ? t('rev.needReason')
      : null;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <FormField
        id={`revoke-reason-${agreementId}`}
        label={t('rev.reason')}
        hint={t('rev.reasonHint')}
        required
        locale={locale}
        error={fieldError(cmd.error?.fieldErrors, 'reason')}
      >
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canReview} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="danger"
          loading={cmd.pending}
          disabledReason={disabled}
          onClick={() =>
            cmd.run(
              `/api/agreements/${agreementId}/revoke`,
              'POST',
              { expected_revision: revision, reason: reason.trim() },
              { navigateTo: `/flo/${floId}/perjanjian?notice=revoked&v=${version}` },
            )
          }
        >
          {cmd.pending ? t('action.saving') : t('rev.revoke', { v: version })}
        </Button>
      </div>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
      {cmd.result != null && <CommandStatus tone="ok" text={t('rev.revoked')} />}
    </div>
  );
}
