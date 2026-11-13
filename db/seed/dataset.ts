/**
 * In-memory seed dataset: rows per table in FK-safe insertion order, plus deferred
 * column updates for the few circular references. Pure data (no I/O), so the
 * generator can be deep-compared in unit tests.
 */
export type Row = Record<string, unknown>;

/** FK-safe insertion order. Every table the seed writes must be listed here. */
export const TABLE_ORDER = [
  'tenants',
  'users',
  'memberships',
  'volunteer_profiles',
  'tenant_clocks',
  'policy_versions',
  'tenant_active_policies',
  'activation_decisions',
  'simulation_settings',
  'categories',
  'products',
  'unit_conversions',
  'clusters',
  'donors',
  'donor_contacts',
  'source_locations',
  'storage_locations',
  'media_files',
  'flos',
  'flo_clusters',
  'flo_contacts',
  'flo_category_prefs',
  'service_schedules',
  'category_demands',
  'availability_windows',
  'flo_category_capacities',
  'need_assessments',
  'agreements',
  'renewal_tasks',
  'donation_orders',
  'donation_items',
  'safety_evaluations',
  'release_plans',
  'outreach_campaigns',
  'campaign_lines',
  'allocations',
  'offers',
  'reservations',
  'transport_arrangements',
  'approvals',
  'expected_inbounds',
  'inbound_lines',
  'inspections',
  'inspection_lines',
  'dispositions',
  'inventory_batches',
  'reservation_lines',
  'deliveries',
  'delivery_lines',
  'volunteer_routes',
  'flo_receipts',
  'receipt_lines',
  'distribution_events',
  'distribution_event_lines',
  'stock_movements',
  'movement_entries',
  'batch_balances',
  'evidence_obligations',
  'evidence_submissions',
  'submission_files',
  'evidence_reviews',
  'tasks',
  'jobs',
  'external_mappings',
  'audit_events',
] as const;

export type TableName = (typeof TABLE_ORDER)[number];

export interface DeferredUpdate {
  table: TableName;
  column: string;
  /** rows of { id, value } */
  rows: { id: string; value: unknown }[];
}

export class Dataset {
  readonly tables = new Map<TableName, Row[]>();
  readonly deferred: DeferredUpdate[] = [];

  add(table: TableName, row: Row): Row {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    rows.push(row);
    return row;
  }

  rows(table: TableName): Row[] {
    return this.tables.get(table) ?? [];
  }

  count(table: TableName): number {
    return this.rows(table).length;
  }

  defer(table: TableName, column: string, id: string, value: unknown): void {
    let d = this.deferred.find((x) => x.table === table && x.column === column);
    if (!d) {
      d = { table, column, rows: [] };
      this.deferred.push(d);
    }
    d.rows.push({ id, value });
  }
}
