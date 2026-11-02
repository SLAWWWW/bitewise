import type { Dict } from '../types';

/** English — 'audit' namespace (owner: W2-SHELL). Page: app/(ops)/audit. */
const audit = {
  title: 'Audit',
  subtitle: 'Audit trail of decisions and changes. Append-only: records cannot be edited or deleted.',
  eyebrow: 'Compliance',

  'filter.legend': 'Filter events',
  'filter.subjectType': 'Subject type',
  'filter.actor': 'Actor',
  'filter.action': 'Action',
  'filter.actorKind': 'Actor kind',
  'filter.from': 'From date (WIB)',
  'filter.to': 'To date (WIB)',
  'filter.any': 'All',
  'filter.apply': 'Apply filters',
  'filter.clear': 'Clear filters',
  'filter.dateHint': 'Local Asia/Jakarta dates (WIB), last day included.',
  'filter.invalid': 'Invalid filters: {fields}',
  'filter.active': 'Active filters',

  'col.time': 'Time',
  'col.actor': 'Actor',
  'col.action': 'Action',
  'col.subject': 'Subject',
  'col.reason': 'Reason',
  'col.policy': 'Policy',
  'col.correlation': 'Correlation',
  'col.payload': 'Payload',

  'subject.revision': 'rev. {n}',
  'actor.unknownUser': 'User {id}',
  'actorKind.USER': 'User',
  'actorKind.WORKER': 'Background worker',
  'actorKind.AGENT': 'AI agent',
  'actorKind.FLO_LINK': 'FLO link',
  'actorKind.SYSTEM': 'System',
  'payload.show': 'Show payload',

  caption: 'Audit events, newest first',
  'page.count': '{count} events on this page',
  'page.next': 'Next page',
  'page.first': 'Back to newest',
  'page.end': 'End of the audit trail for these filters.',
  empty: 'No audit events match these filters.',
  emptyAll: 'This tenant has no audit events yet.',
  unauthorised: 'The audit page requires the audit.read permission.',
  'error.title': 'The audit trail could not be loaded',
} satisfies Dict;

export default audit;
