/**
 * Route-handler wrapper. Every `app/api/**` handler should be built with `handler()`:
 *
 *   export const POST = handler(
 *     { capability: 'agreement.review', body: approveSchema, idempotent: true,
 *       route: '/api/agreements/[id]/approve', notFoundOnForbidden: true },
 *     async ({ actor, body, params, tx, idempotencyKey, requestHash, ok }) => {
 *       const res = await tx((c) => c.query('select lumbung.approve_agreement($1,$2,$3,$4,$5)', [...]));
 *       return ok(res.rows[0].approve_agreement, { revision: 3 });
 *     },
 *   );
 *
 * It provides: correlation id (x-correlation-id header or random), actor resolution
 * from the Request cookie (never next/headers), optional capability check (403),
 * zod body/query parsing (400 + field_errors), Idempotency-Key requirement +
 * request_hash, DomainError → envelope/status, and 404 instead of 403 for
 * object-scoped routes so another tenant's object existence never leaks.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, mapDbError, type FieldErrors } from '@/src/db/errors';
import { withTx, type TxOptions } from '@/src/db/tx';
import type { TxClient } from '@/src/db/types';
import { getActor, actorCtx, type Actor } from '@/src/security/actor';
import { requireCap } from '@/src/security/capabilities';
import type { Capability } from '@/src/shared/capabilities';
import { CORRELATION_HEADER, errorResponse, okResponse } from './envelope';
import { computeRequestHash, IDEMPOTENCY_HEADER, isValidIdempotencyKey } from './idempotency';

type AuthMode = 'required' | 'optional' | 'none';

export interface HandlerOptions<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> {
  /** Default 'required'. 'none' skips session lookup entirely (health, webhooks). */
  auth?: AuthMode;
  /** Capability required before the handler runs (403 CAPABILITY_REQUIRED). */
  capability?: Capability;
  body?: B;
  query?: Q;
  /** Require an Idempotency-Key header and compute request_hash. */
  idempotent?: boolean;
  /** Route template for request_hash, e.g. '/api/agreements/[id]/approve'. Defaults to the URL path. */
  route?: string;
  /** Param name holding the subject id for request_hash (default 'id'). */
  subjectParam?: string;
  /** Map FORBIDDEN / NOT_FOUND / tenant-mismatch from the object layer to 404 NOT_FOUND. */
  notFoundOnForbidden?: boolean;
  /** Transaction options for ctx.tx (e.g. retries). */
  tx?: TxOptions;
}

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerContext<B, Q, A> {
  request: Request;
  params: Record<string, string | string[]>;
  correlationId: string;
  actor: A;
  body: B;
  query: Q;
  idempotencyKey: string | null;
  requestHash: string | null;
  /** Run `fn` in a tenant-scoped transaction for this actor. */
  tx: <T>(fn: (c: TxClient) => Promise<T>) => Promise<T>;
  /** Build a success envelope response with optional revision/status. */
  ok: <T>(data: T, opts?: { status?: number; revision?: number; headers?: HeadersInit }) => Response;
}

type ActorFor<O> = O extends { auth: 'none' } ? null : O extends { auth: 'optional' } ? Actor | null : Actor;

const CORRELATION_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationIdFrom(request: Request): string {
  const h = request.headers.get(CORRELATION_HEADER);
  return h && CORRELATION_RE.test(h) ? h : randomUUID();
}

/** zod error → { field: [messages] }; root errors go under "_". */
export function zodFieldErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function validationError(err: z.ZodError, where: 'body' | 'query'): DomainError {
  return new DomainError({
    code: 'VALIDATION_FAILED',
    message: where === 'body' ? 'Request body is invalid' : 'Query parameters are invalid',
    field_errors: zodFieldErrors(err),
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError({ code: 'BAD_REQUEST', message: 'Malformed JSON body' });
  }
}

const HIDE_AS_404 = new Set(['FORBIDDEN', 'NOT_FOUND', 'TENANT_MISMATCH']);

export function handler<
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  O extends HandlerOptions<B, Q> = HandlerOptions<B, Q>,
>(
  opts: O & HandlerOptions<B, Q>,
  fn: (ctx: HandlerContext<Infer<B>, Infer<Q>, ActorFor<O>>) => Promise<Response | unknown>,
) {
  function routeHandler(request: Request): Promise<Response>;
  function routeHandler(request: Request, routeCtx: { params: Promise<Record<string, string | string[]>> }): Promise<Response>;
  async function routeHandler(
    request: Request,
    routeCtx?: { params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> },
  ): Promise<Response> {
    const correlationId = correlationIdFrom(request);
    try {
      const params = ((await routeCtx?.params) ?? {}) as Record<string, string | string[]>;
      const auth: AuthMode = opts.auth ?? 'required';

      let actor: Actor | null = null;
      if (auth !== 'none') {
        actor = await getActor(request, correlationId);
        if (!actor && auth === 'required') {
          throw new DomainError({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
        }
      }
      if (opts.capability) requireCap(actor, opts.capability);

      let query: unknown = undefined;
      if (opts.query) {
        const url = new URL(request.url);
        const raw: Record<string, string | string[]> = {};
        for (const k of new Set(url.searchParams.keys())) {
          const all = url.searchParams.getAll(k);
          raw[k] = all.length > 1 ? all : all[0];
        }
        const r = opts.query.safeParse(raw);
        if (!r.success) throw validationError(r.error, 'query');
        query = r.data;
      }

      let rawBody: unknown = undefined;
      let body: unknown = undefined;
      const method = request.method.toUpperCase();
      if (opts.body) {
        rawBody = await readJson(request);
        const r = opts.body.safeParse(rawBody ?? {});
        if (!r.success) throw validationError(r.error, 'body');
        body = r.data;
      } else if (opts.idempotent && method !== 'GET' && method !== 'HEAD') {
        rawBody = await readJson(request);
      }

      let idempotencyKey: string | null = null;
      let requestHash: string | null = null;
      if (opts.idempotent) {
        const key = request.headers.get(IDEMPOTENCY_HEADER);
        if (!isValidIdempotencyKey(key)) {
          throw new DomainError({
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header (8–200 chars of [A-Za-z0-9._:-]) is required',
            field_errors: { 'Idempotency-Key': ['Required'] },
          });
        }
        idempotencyKey = key;
        const subject = params[opts.subjectParam ?? 'id'];
        requestHash = computeRequestHash({
          method,
          route: opts.route ?? new URL(request.url).pathname,
          subjectId: Array.isArray(subject) ? subject.join('/') : (subject ?? null),
          body: body ?? rawBody ?? null,
        });
      }

      const ctx: HandlerContext<unknown, unknown, Actor | null> = {
        request,
        params,
        correlationId,
        actor,
        body,
        query,
        idempotencyKey,
        requestHash,
        tx: (txFn) => {
          if (!actor) throw new DomainError({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
          return withTx(actorCtx(actor, correlationId), txFn, opts.tx);
        },
        ok: (data, o) => okResponse(data, correlationId, o),
      };

      const result = await fn(ctx as HandlerContext<Infer<B>, Infer<Q>, ActorFor<O>>);
      if (result instanceof Response) {
        if (!result.headers.has(CORRELATION_HEADER)) {
          try {
            result.headers.set(CORRELATION_HEADER, correlationId);
          } catch {
            /* immutable headers (e.g. Response.redirect) */
          }
        }
        return result;
      }
      return okResponse(result, correlationId);
    } catch (e) {
      let err = mapDbError(e);
      if (opts.notFoundOnForbidden && HIDE_AS_404.has(err.code) && err.code !== 'CAPABILITY_REQUIRED') {
        err = new DomainError({ code: 'NOT_FOUND', message: 'Not found' });
      }
      if (err.http >= 500) {
        console.error(`[lumbung] ${correlationId} ${request.method} ${opts.route ?? new URL(request.url).pathname.replace(/\/f\/[^/]+/, '/f/[token]')} → ${err.code}`, e);
      }
      return errorResponse(err, correlationId);
    }
  }
  return routeHandler;
}
