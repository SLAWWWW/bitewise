/**
 * Runtime mode + adapters actually in use (from the validated env), and availability of
 * the Stage-2 demo endpoints. Contains no secrets: tokens/keys are never returned, only
 * which adapter is active.
 */
import 'server-only';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getEnv, type AppMode } from '@/src/config/env';

export interface RuntimeInfo {
  appMode: AppMode;
  timezone: string;
  /** Effective adapter (DEMO/TEST always 'mock', INV10). */
  messaging: 'mock' | 'fonnte';
  /** What was configured, if different from the effective adapter. */
  messagingConfigured: 'mock' | 'fonnte' | null;
  routing: 'fixture' | 'straight_line';
  llm: 'fake' | 'gemini';
  /** Only meaningful for gemini. */
  llmModel: string | null;
}

export function runtimeInfo(): RuntimeInfo {
  const env = getEnv();
  return {
    appMode: env.APP_MODE,
    timezone: env.APP_TIMEZONE,
    messaging: env.MESSAGING_ADAPTER,
    messagingConfigured: env.MESSAGING_ADAPTER_CONFIGURED !== env.MESSAGING_ADAPTER ? env.MESSAGING_ADAPTER_CONFIGURED : null,
    routing: env.ROUTING_ADAPTER,
    llm: 'fake',
    llmModel: null,
  };
}

/** Demo endpoints (owned by Stage 2: app/api/demo/{reset,advance-clock}/route.ts). */
export const DEMO_ENDPOINTS = {
  reset: '/api/demo/reset',
  advanceClock: '/api/demo/advance-clock',
} as const;
export type DemoEndpoint = keyof typeof DEMO_ENDPOINTS;

/**
 * Whether a demo endpoint has been built: the route source (dev / `next start` from the
 * repo) or its compiled server bundle exists. Until Stage 2 lands, the settings page
 * renders the controls disabled with the reason "tersedia di Tahap 2".
 */
export function demoEndpointAvailable(which: DemoEndpoint, root: string = process.cwd()): boolean {
  const rel = DEMO_ENDPOINTS[which].replace(/^\//, ''); // api/demo/reset
  const candidates = [
    path.join(root, 'app', rel, 'route.ts'),
    path.join(root, 'app', rel, 'route.js'),
    path.join(root, '.next', 'server', 'app', rel, 'route.js'),
  ];
  return candidates.some((p) => existsSync(p));
}
