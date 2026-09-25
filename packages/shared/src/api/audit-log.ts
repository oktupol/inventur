/** What an audit log entry records. */
export type AuditAction =
  | 'quantity_changed'
  | 'serial_number_changed'
  | 'deleted'
  | 'restored'
  | 'stocktake_finished'
  | 'stocktake_reopened';

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'quantity_changed',
  'serial_number_changed',
  'deleted',
  'restored',
  'stocktake_finished',
  'stocktake_reopened',
];

/** Where a change was made: at a workstation, with a phone paired to it, or in the dashboard. */
export type AuditSource = 'station' | 'phone' | 'admin';

/** A later change to a line, or finishing and reopening the stocktake. */
export interface AuditLogEntry {
  id: number;
  action: AuditAction;
  /** The changed line; it may no longer exist. */
  entryId: number | null;
  /** Work area of the line, with its name at the time of the change. */
  workArea: { id: number; name: string } | null;
  /** Description and code (EAN or input) of the line's article. */
  description: string | null;
  code: string | null;
  /** E.g. the quantity before and after; null where it does not apply. */
  oldValue: string | null;
  newValue: string | null;
  source: AuditSource;
  /** Workstation with its name at the time of the change; null in the dashboard. */
  workstation: { id: number; name: string } | null;
  /** Employees logged in at the workstation. */
  employees: string[];
  createdAt: string;
}

/** Filters of `GET /api/admin/stocktakes/:id/audit-log`. */
export interface AuditLogQuery {
  workAreaId?: number;
  workstationId?: number;
  action?: AuditAction;
  /** Only entries older than this id, for loading more. */
  before?: number;
}

/** `GET /api/admin/stocktakes/:id/audit-log`: newest first, one page. */
export interface AuditLogResponse {
  entries: AuditLogEntry[];
  /** More entries exist before the last one. */
  hasMore: boolean;
}
