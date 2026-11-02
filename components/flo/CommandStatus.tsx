/** Inline result line for a command (no toasts: the message stays next to the action). */
export function CommandStatus({ tone, text }: { tone: 'ok' | 'error'; text: string }) {
  return tone === 'error' ? (
    <p role="alert" className="lb-field-error">
      {text}
    </p>
  ) : (
    <p role="status" className="text-caption text-[var(--success)]">
      {text}
    </p>
  );
}

/** First field error for a key from the API envelope (field_errors). */
export function fieldError(errors: Record<string, string[]> | undefined, key: string): string | undefined {
  return errors?.[key]?.[0];
}
