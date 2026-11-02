'use client';

import { Button } from '@/components/ui/Button';
import { useT } from '@/src/i18n/client';
import { CommandStatus } from './CommandStatus';
import { useCommand } from './useCommand';

/** Confirm a proposed need assessment (need.confirm). */
export function NeedConfirmButton({ floId, needId, canConfirm }: { floId: string; needId: string; canConfirm: boolean }) {
  const t = useT('flo');
  const cmd = useCommand();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={cmd.pending}
        disabledReason={canConfirm ? null : t('needs.confirmReason')}
        onClick={() => cmd.run(`/api/flos/${floId}/needs`, 'POST', { action: 'CONFIRM', need_id: needId })}
      >
        {t('needs.confirm')}
      </Button>
      {cmd.error && <CommandStatus tone="error" text={cmd.error.message} />}
    </span>
  );
}
