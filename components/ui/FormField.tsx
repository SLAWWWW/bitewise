import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { t, type Locale } from '@/src/i18n';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
  className?: string;
};

/**
 * Label + control + hint + error, wired for assistive tech: the single child control
 * receives id, aria-describedby (hint + error) and aria-invalid. Server/client safe.
 *
 *   <FormField id="qty" label="Jumlah" hint="Maks. 3 desimal" error={errors.qty?.[0]}>
 *     <input className="input" name="qty" />
 *   </FormField>
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  locale = 'id',
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** One message or the field_errors array from the API envelope. */
  error?: string | string[] | null;
  required?: boolean;
  children: ReactElement<ControlProps>;
  locale?: Locale;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errors = (Array.isArray(error) ? error : error ? [error] : []).filter(Boolean);
  const errorId = errors.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': errors.length ? true : undefined,
        required: required ?? children.props.required,
      })
    : children;

  return (
    <div className="lb-field">
      <label htmlFor={id} className="form-label">
        {label}
        {required && (
          <span className="lb-field-required">
            {' '}
            <span aria-hidden="true">*</span>
            <span className="sr-only">({t('common', 'word.required', undefined, locale)})</span>
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="lb-field-hint">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="lb-field-error" role="alert">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}
