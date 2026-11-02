/**
 * Response envelope (architecture G.4, PRD §19):
 *   success { data, correlation_id, revision? }
 *   error   { error: { code, message, retryable, field_errors? }, correlation_id }
 */
import { DomainError, type FieldErrors } from '@/src/db/errors';

export interface SuccessEnvelope<T> {
  data: T;
  correlation_id: string;
  revision?: number;
}

export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  field_errors?: FieldErrors;
}

export interface ErrorEnvelope {
  error: ErrorBody;
  correlation_id: string;
}

export const CORRELATION_HEADER = 'x-correlation-id';

function json(body: unknown, status: number, correlationId: string, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  h.set(CORRELATION_HEADER, correlationId);
  return new Response(JSON.stringify(body, jsonReplacer), { status, headers: h });
}

/** bigint → string so quantities never become floats on the wire. */
function jsonReplacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function successBody<T>(data: T, correlationId: string, revision?: number): SuccessEnvelope<T> {
  return revision === undefined ? { data, correlation_id: correlationId } : { data, correlation_id: correlationId, revision };
}

export function okResponse<T>(
  data: T,
  correlationId: string,
  opts: { status?: number; revision?: number; headers?: HeadersInit } = {},
): Response {
  return json(successBody(data, correlationId, opts.revision), opts.status ?? 200, correlationId, opts.headers);
}

/** Error body; 5xx messages are generic (never leak internals). */
export function errorBody(err: DomainError, correlationId: string): ErrorEnvelope {
  const internal = err.http >= 500;
  const body: ErrorBody = {
    code: err.code,
    message: internal ? (err.http === 503 ? 'Service temporarily unavailable' : 'Internal error') : err.message,
    retryable: err.retryable,
  };
  if (err.field_errors && !internal) body.field_errors = err.field_errors;
  return { error: body, correlation_id: correlationId };
}

export function errorResponse(err: DomainError, correlationId: string, headers?: HeadersInit): Response {
  return json(errorBody(err, correlationId), err.http, correlationId, headers);
}
