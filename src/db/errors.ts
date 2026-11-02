/**
 * DomainError and the mapping from Postgres errors to it.
 *
 * SQL command functions raise `RAISE EXCEPTION USING ERRCODE='P0001',
 * MESSAGE='LB:<CODE>', DETAIL=<json>`; this module turns that (and selected native
 * pg error codes) into a DomainError with an HTTP status, retryable flag and optional
 * field errors. No `server-only` import: pure and unit-testable.
 */
import { errorSpec, type HttpStatus } from '@/src/shared/codes';

export type FieldErrors = Record<string, string[]>;

export interface DomainErrorInit {
  code: string;
  message?: string;
  http?: HttpStatus;
  retryable?: boolean;
  field_errors?: FieldErrors;
  /** Extra structured detail for logs / callers. Never sent for 5xx. */
  detail?: Record<string, unknown>;
  cause?: unknown;
}

export class DomainError extends Error {
  readonly code: string;
  readonly http: HttpStatus;
  readonly retryable: boolean;
  readonly field_errors?: FieldErrors;
  readonly detail?: Record<string, unknown>;
  /** Original SQLSTATE when mapped from a pg error (e.g. '42501', 'P0001'). */
  readonly pgCode?: string;

  constructor(init: DomainErrorInit & { pgCode?: string }) {
    super(init.message ?? init.code, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'DomainError';
    const s = errorSpec(init.code);
    this.code = init.code;
    this.http = init.http ?? s.http;
    this.retryable = init.retryable ?? s.retryable;
    this.field_errors = init.field_errors;
    this.detail = init.detail;
    this.pgCode = init.pgCode;
  }
}

export function domainError(code: string, message?: string, extra: Omit<DomainErrorInit, 'code' | 'message'> = {}) {
  return new DomainError({ code, message, ...extra });
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Shape of the pg DatabaseError fields we rely on. */
export interface PgErrorLike {
  code?: string;
  message?: string;
  detail?: string;
  constraint?: string;
  column?: string;
  table?: string;
}

function isPgErrorLike(e: unknown): e is PgErrorLike & Error {
  return typeof e === 'object' && e !== null && typeof (e as PgErrorLike).code === 'string';
}

const ALLOWED_DETAIL_HTTP = new Set<number>([400, 403, 404, 409, 422]);
const LB_PREFIX = /^LB:([A-Z0-9_]+)(?::\s*(.*))?$/s;

function parseDetail(detail: string | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  try {
    const v = JSON.parse(detail);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { text: detail };
  }
}

function asFieldErrors(v: unknown): FieldErrors | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: FieldErrors = {};
  for (const [k, msgs] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(msgs)) out[k] = msgs.map(String);
    else if (typeof msgs === 'string') out[k] = [msgs];
  }
  return Object.keys(out).length ? out : undefined;
}

const SERIALIZATION_CODES = new Set(['40001', '40P01']);

export function isRetryablePgError(e: unknown): boolean {
  return isPgErrorLike(e) && SERIALIZATION_CODES.has(e.code ?? '');
}

const CONNECTION_ERRNOS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);

/**
 * Convert anything thrown by a DB call into a DomainError. Already-DomainErrors pass
 * through untouched.
 */
export function mapDbError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (!isPgErrorLike(e)) {
    return new DomainError({ code: 'INTERNAL', message: 'Internal error', cause: e });
  }
  const mapped = mapPgError(e);
  return new DomainError({
    code: mapped.code,
    message: mapped.message,
    http: mapped.http,
    retryable: mapped.retryable,
    field_errors: mapped.field_errors,
    detail: mapped.detail,
    cause: e,
    pgCode: e.code,
  });
}

function mapPgError(e: PgErrorLike & Error): DomainError {
  const code = e.code ?? '';

  if (code === 'P0001') {
    const m = LB_PREFIX.exec(e.message ?? '');
    if (m) {
      const lbCode = m[1];
      const detail = parseDetail(e.detail);
      const httpOverride =
        detail && typeof detail.http === 'number' && ALLOWED_DETAIL_HTTP.has(detail.http)
          ? (detail.http as HttpStatus)
          : undefined;
      const retryable = detail && typeof detail.retryable === 'boolean' ? detail.retryable : undefined;
      const message =
        (detail && typeof detail.message === 'string' ? detail.message : undefined) ?? m[2] ?? lbCode;
      return new DomainError({
        code: lbCode,
        message,
        http: httpOverride,
        retryable,
        field_errors: asFieldErrors(detail?.field_errors),
        detail,
        cause: e,
      });
    }
    return new DomainError({ code: 'POLICY_VIOLATION', message: 'Rejected by policy', cause: e });
  }

  switch (code) {
    case '23505':
      return new DomainError({ code: 'CONFLICT', message: 'Duplicate value', detail: { constraint: e.constraint }, cause: e });
    case '42501':
      return new DomainError({ code: 'FORBIDDEN', message: 'Not permitted', cause: e });
    case '23514':
    case '23503':
    case '23502':
      return new DomainError({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Constraint violated',
        detail: { constraint: e.constraint, column: e.column },
        cause: e,
      });
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return new DomainError({ code: 'BAD_REQUEST', message: 'Malformed value', cause: e });
    case '40001':
    case '40P01':
      return new DomainError({ code: 'SERIALIZATION_FAILURE', message: 'Concurrent update, please retry', cause: e });
    case '55P03':
      return new DomainError({ code: 'CONFLICT', message: 'Resource is locked', retryable: true, cause: e });
  }
  if (code.startsWith('08') || code === '57P01' || code === '57P03' || CONNECTION_ERRNOS.has(code)) {
    return new DomainError({ code: 'DB_UNAVAILABLE', message: 'Database unavailable', cause: e });
  }
  return new DomainError({ code: 'INTERNAL', message: 'Internal error', cause: e });
}
