import type { AuditLogQuery, AuditLogResponse, AuditSource } from '@inventur/shared';
import type { Db } from '../db/connection.ts';
import { toCsv } from '../export/csv.ts';
import { CONTENT_TYPES, type ExportFile, type ExportFormat } from '../export/service.ts';
import { auditLogTable } from '../export/table.ts';
import { toXlsx } from '../export/xlsx.ts';
import { safeFileName } from '../http/download.ts';
import type { StationIdentity } from '../station/service.ts';
import { getStocktake, type Trx } from '../stocktake/service.ts';
import { AUDIT_LOG_PAGE_SIZE, toAuditLogEntry, toPage, type AuditChange } from './rules.ts';

/** Who makes a change: a workstation (directly or with a paired phone) or the dashboard. */
export type AuditActor =
  { source: Exclude<AuditSource, 'admin'>; workstation: StationIdentity } | { source: 'admin' };

/**
 * Writes an audit log entry within the transaction of the change, with the
 * names of the work area, the workstation and its logged-in employees at
 * this moment. `snapshot` keeps a deleted line for restoring it.
 */
export async function recordAudit(
  trx: Trx,
  stocktakeId: number,
  actor: AuditActor,
  change: AuditChange,
  snapshot?: unknown,
): Promise<void> {
  const workArea =
    change.work_area_id === null
      ? undefined
      : await trx
          .selectFrom('inventory.work_area')
          .select('name')
          .where('id', '=', change.work_area_id)
          .executeTakeFirst();
  const employees =
    actor.source === 'admin'
      ? []
      : await trx
          .selectFrom('inventory.employee')
          .select('name')
          .where('workstation_id', '=', actor.workstation.id)
          .orderBy('name')
          .execute();
  await trx
    .insertInto('inventory.audit_log')
    .values({
      ...change,
      stocktake_id: stocktakeId,
      work_area_name: workArea?.name ?? null,
      entry_snapshot: snapshot === undefined ? null : JSON.stringify(snapshot),
      source: actor.source,
      workstation_id: actor.source === 'admin' ? null : actor.workstation.id,
      workstation_name: actor.source === 'admin' ? null : actor.workstation.name,
      employee_names: employees.map((e) => e.name),
    })
    .execute();
}

/** Audit log rows of a stocktake with the filters of the list, newest first. */
export function auditLogQuery(db: Db, stocktakeId: number, query: AuditLogQuery) {
  return db
    .selectFrom('inventory.audit_log')
    .select([
      'id',
      'action',
      'entry_id',
      'work_area_id',
      'work_area_name',
      'description',
      'code',
      'old_value',
      'new_value',
      'source',
      'workstation_id',
      'workstation_name',
      'employee_names',
      'created_at',
    ])
    .where('stocktake_id', '=', stocktakeId)
    .$if(query.workAreaId !== undefined, (q) => q.where('work_area_id', '=', query.workAreaId!))
    .$if(query.workstationId !== undefined, (q) =>
      q.where('workstation_id', '=', query.workstationId!),
    )
    .$if(query.action !== undefined, (q) => q.where('action', '=', query.action!))
    .$if(query.before !== undefined, (q) => q.where('id', '<', query.before!))
    .orderBy('id', 'desc');
}

/** One page of the audit log of a stocktake, newest first. */
export async function listAuditLog(
  db: Db,
  stocktakeId: number,
  query: AuditLogQuery,
): Promise<AuditLogResponse> {
  await getStocktake(db, stocktakeId);
  const rows = await auditLogQuery(db, stocktakeId, query)
    .limit(AUDIT_LOG_PAGE_SIZE + 1)
    .execute();
  const page = toPage(rows, AUDIT_LOG_PAGE_SIZE);
  return { entries: page.items.map(toAuditLogEntry), hasMore: page.hasMore };
}

/** The complete audit log of a stocktake as CSV or XLSX, with the filters of the list. */
export async function exportAuditLog(
  db: Db,
  stocktakeId: number,
  query: Omit<AuditLogQuery, 'before'>,
  format: ExportFormat,
): Promise<ExportFile> {
  const stocktake = await getStocktake(db, stocktakeId);
  const rows = await auditLogQuery(db, stocktakeId, query).execute();
  const table = auditLogTable(rows.map(toAuditLogEntry));
  const title = 'Änderungsprotokoll';
  return {
    filename: `${safeFileName(`${stocktake.name} - ${title}`)}.${format}`,
    contentType: CONTENT_TYPES[format],
    body: format === 'csv' ? await toCsv(table) : await toXlsx(table, title),
  };
}
