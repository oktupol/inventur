import type { AuditAction, AuditLogEntry, AuditSource } from '@inventur/shared';

/** The part of a line an audit log entry describes. */
export interface AuditedEntry {
  id: number;
  work_area_id: number;
  description: string;
  ean: string | null;
  input: string;
}

/** Values of an audit log row that depend on the change, not on who made it. */
export interface AuditChange {
  action: AuditAction;
  entry_id: number | null;
  work_area_id: number | null;
  description: string | null;
  code: string | null;
  old_value: string | null;
  new_value: string | null;
}

/** The code shown for a line: its EAN, otherwise the scanned or typed input. */
export function entryCode(entry: Pick<AuditedEntry, 'ean' | 'input'>): string | null {
  return entry.ean ?? (entry.input.trim() || null);
}

/** A change of a line with the given values before and after. */
export function entryChange(
  action: AuditAction,
  entry: AuditedEntry,
  oldValue: string | number | null,
  newValue: string | number | null,
): AuditChange {
  return {
    action,
    entry_id: entry.id,
    work_area_id: entry.work_area_id,
    description: entry.description,
    code: entryCode(entry),
    old_value: oldValue === null ? null : String(oldValue),
    new_value: newValue === null ? null : String(newValue),
  };
}

/** A change of the whole stocktake, e.g. finishing it. */
export function stocktakeChange(action: AuditAction): AuditChange {
  return {
    action,
    entry_id: null,
    work_area_id: null,
    description: null,
    code: null,
    old_value: null,
    new_value: null,
  };
}

export interface AuditLogRow {
  id: number;
  action: AuditAction;
  entry_id: number | null;
  work_area_id: number | null;
  work_area_name: string | null;
  description: string | null;
  code: string | null;
  old_value: string | null;
  new_value: string | null;
  source: AuditSource;
  workstation_id: number | null;
  workstation_name: string | null;
  employee_names: string[];
  created_at: Date;
}

export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    entryId: row.entry_id,
    workArea:
      row.work_area_id === null ? null : { id: row.work_area_id, name: row.work_area_name ?? '' },
    description: row.description,
    code: row.code,
    oldValue: row.old_value,
    newValue: row.new_value,
    source: row.source,
    workstation:
      row.workstation_id === null
        ? null
        : { id: row.workstation_id, name: row.workstation_name ?? '' },
    employees: row.employee_names,
    createdAt: row.created_at.toISOString(),
  };
}

/** Entries shown per page of the audit log. */
export const AUDIT_LOG_PAGE_SIZE = 200;

/**
 * Splits rows loaded with one extra row into a page and whether more exist.
 */
export function toPage<T>(rows: readonly T[], size: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}
