/**
 * Namespace registry. To add a namespace: create src/i18n/{id,en}/<ns>.ts exporting a
 * default Dict, then add one import + one entry per locale below. Pre-registered for
 * Stage 1: common (W1-INFRA), flo (W2-FLO), settings/dashboard/audit (W2-SHELL).
 */
import type { Dict, Locale } from './types';

import idCommon from './id/common';
import idFlo from './id/flo';
import idSettings from './id/settings';
import idDashboard from './id/dashboard';
import idAudit from './id/audit';

import enCommon from './en/common';
import enFlo from './en/flo';
import enSettings from './en/settings';
import enDashboard from './en/dashboard';
import enAudit from './en/audit';
import idDirect from './id/direct';
import enDirect from './en/direct';

import idOps from './id/ops';
import enOps from './en/ops';

export const NAMESPACES = ['common', 'flo', 'settings', 'dashboard', 'audit', 'direct', 'ops'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const DICTIONARIES: Record<Locale, Record<Namespace, Dict>> = {
  id: { common: idCommon, flo: idFlo, settings: idSettings, dashboard: idDashboard, audit: idAudit, direct: idDirect, ops: idOps },
  en: { common: enCommon, flo: enFlo, settings: enSettings, dashboard: enDashboard, audit: enAudit, direct: enDirect, ops: enOps },
};
