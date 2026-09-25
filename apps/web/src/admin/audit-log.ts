import type { AuditLogEntry } from '@inventur/shared';

/**
 * Combines the live first page of the audit log with older pages loaded on
 * request. Entries never change, so the union by id is complete and sorted
 * newest first, even after new entries pushed the first page forward.
 */
export function mergeAuditPages(
  first: readonly AuditLogEntry[],
  older: readonly AuditLogEntry[],
): AuditLogEntry[] {
  const byId = new Map<number, AuditLogEntry>();
  for (const entry of [...older, ...first]) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/** The change as short text, e.g. "1 → 3" or "Menge 2". */
export function describeChange(entry: AuditLogEntry): string {
  switch (entry.action) {
    case 'quantity_changed':
      return `${entry.oldValue ?? '–'} → ${entry.newValue ?? '–'}`;
    case 'serial_number_changed':
      return `${entry.oldValue ?? '(keine)'} → ${entry.newValue ?? '(keine)'}`;
    case 'deleted':
      return entry.oldValue === null ? '' : `Menge ${entry.oldValue}`;
    case 'restored':
      return entry.newValue === null ? '' : `Menge ${entry.newValue}`;
    case 'stocktake_finished':
    case 'stocktake_reopened':
      return '';
  }
}
