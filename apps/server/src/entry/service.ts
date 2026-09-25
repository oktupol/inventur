import type {
  CreateEntryRequest,
  CreateEntryResponse,
  CreateManualEntryRequest,
  DeleteEntryResponse,
  RestoreEntryResponse,
  Entry,
  EntryListResponse,
  UpdateEntryRequest,
} from '@inventur/shared';
import { sql } from 'kysely';
import { entryChange } from '../audit/rules.ts';
import { recordAudit, type AuditActor } from '../audit/service.ts';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  loadCheckpoints,
  lockCheckpoints,
  removeEmptyCheckpoints,
  restoreCheckpoints,
} from '../checkpoint/service.ts';
import { DomainError } from '../errors.ts';
import { getArticle, resolveArticle } from '../search/service.ts';
import { requireActiveStocktake } from '../station/rules.ts';
import type { StationIdentity } from '../station/service.ts';
import { getActiveStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';
import {
  assertCanCapture,
  manualEntryValues,
  nextQuantity,
  parseInput,
  parseSerialNumber,
  planRestore,
  snapshotOf,
} from './rules.ts';

function entryQuery(db: Db | Trx) {
  return db
    .selectFrom('inventory.entry as e')
    .innerJoin('inventory.workstation as w', 'w.id', 'e.workstation_id')
    .selectAll('e')
    .select((eb) => [
      'w.name as workstation_name',
      eb
        .selectFrom('inventory.entry as other')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('other.stocktake_id', '=', 'e.stocktake_id')
        .whereRef('other.article_id', '=', 'e.article_id')
        .whereRef('other.id', '!=', 'e.id')
        // Any article repeated within the work area; single items (target
        // quantity 1) also across work areas.
        .where((w) =>
          w.or([
            w('other.work_area_id', '=', w.ref('e.work_area_id')),
            w.exists(
              w
                .selectFrom('master_data.article as a')
                .select('a.id')
                .whereRef('a.id', '=', 'e.article_id')
                .where('a.expected_quantity', '=', 1),
            ),
          ]),
        )
        .as('duplicate_count'),
    ]);
}

type EntryRow = Awaited<ReturnType<ReturnType<typeof entryQuery>['executeTakeFirstOrThrow']>>;

export function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    workAreaId: row.work_area_id,
    articleId: row.article_id,
    isManual: row.is_manual,
    input: row.input,
    description: row.description,
    ean: row.ean,
    category: row.category,
    priceNet: row.price_net,
    priceGross: row.price_gross,
    serialNumber: row.serial_number,
    quantity: row.quantity,
    workstation: { id: row.workstation_id, name: row.workstation_name },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    duplicateCount: Number(row.duplicate_count ?? 0),
    checkpointNumber: null,
  };
}

export async function getEntry(db: Db | Trx, id: number): Promise<Entry> {
  const row = await entryQuery(db).where('e.id', '=', id).executeTakeFirst();
  if (!row) throw new DomainError('not_found', 'Entry not found');
  return toEntry(row);
}

/** The work area of the workstation and whether it may capture there; locks the area against closing. */
export async function lockCaptureContext(trx: Trx, station: StationIdentity) {
  const workstation = await trx
    .selectFrom('inventory.workstation')
    .select('work_area_id')
    .where('id', '=', station.id)
    .executeTakeFirstOrThrow();
  const workArea =
    workstation.work_area_id === null
      ? undefined
      : await trx
          .selectFrom('inventory.work_area')
          .select(['id', 'stocktake_id', 'status'])
          .where('id', '=', workstation.work_area_id)
          .forShare()
          .executeTakeFirst();
  const employees = await trx
    .selectFrom('inventory.employee')
    .select('id')
    .where('workstation_id', '=', station.id)
    .execute();
  assertCanCapture({ workArea: workArea ?? null, employeeCount: employees.length });
  return { workArea: workArea!, employeeIds: employees.map((e) => e.id) };
}

/**
 * Captures an input. A unique article becomes a new line with a snapshot of
 * the master data and the logged-in employees; ambiguous and unknown inputs
 * are returned without creating anything.
 */
export async function createEntry(
  { db, events }: Context,
  station: StationIdentity,
  request: CreateEntryRequest,
): Promise<CreateEntryResponse> {
  const input = parseInput(request.input);
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;

  const outcome = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea, employeeIds } = await lockCaptureContext(trx, station);

    if (request.requestId) {
      const existing = await trx
        .selectFrom('inventory.entry')
        .select('id')
        .where('request_id', '=', request.requestId)
        .executeTakeFirst();
      if (existing) {
        return { response: { result: 'unique', entry: await getEntry(trx, existing.id) } as const };
      }
    }

    let article;
    if (request.articleId !== undefined) {
      article = await getArticle(trx, request.articleId);
      if (!article) throw new DomainError('not_found', 'Article not found');
    } else {
      const resolution = await resolveArticle(trx, input);
      if (resolution.result === 'not_found') return { response: { result: 'not_found' } as const };
      if (resolution.result === 'ambiguous') {
        const { articles, hasMore } = resolution;
        return { response: { result: 'ambiguous', articles, hasMore } as const };
      }
      article = resolution.articles[0]!;
    }

    const { id } = await trx
      .insertInto('inventory.entry')
      .values({
        ...snapshotOf(article),
        stocktake_id: stocktakeId,
        work_area_id: workArea.id,
        input,
        serial_number: null,
        workstation_id: station.id,
        request_id: request.requestId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('inventory.entry_employee')
      .values(employeeIds.map((employee_id) => ({ entry_id: id, employee_id })))
      .execute();
    const entry = await getEntry(trx, id);
    return { response: { result: 'unique', entry } as const, created: entry };
  }).catch(async (error: unknown) => {
    // A concurrent retry with the same request id created the line first.
    if (request.requestId && isUniqueViolation(error, 'entry_request_id_key')) {
      const existing = await db
        .selectFrom('inventory.entry')
        .select('id')
        .where('request_id', '=', request.requestId)
        .executeTakeFirstOrThrow();
      return { response: { result: 'unique', entry: await getEntry(db, existing.id) } as const };
    }
    throw error;
  });

  if ('created' in outcome && outcome.created) {
    events.publish({
      type: 'entry.changed',
      action: 'created',
      stocktakeId,
      workAreaId: outcome.created.workAreaId,
      entryId: outcome.created.id,
    });
  }
  return outcome.response;
}

/** The lines of the workstation's work area, newest first, with totals. */
export async function listEntries(db: Db, station: StationIdentity): Promise<EntryListResponse> {
  const workArea = await db
    .selectFrom('inventory.workstation as w')
    .innerJoin('inventory.work_area as a', 'a.id', 'w.work_area_id')
    .select(['a.id', 'a.name', 'a.status'])
    .where('w.id', '=', station.id)
    .executeTakeFirst();
  if (!workArea) throw new DomainError('no_work_area', 'Workstation is not in a work area');
  return { workArea, ...(await listWorkAreaEntries(db, workArea.id)) };
}

export async function listWorkAreaEntries(db: Db | Trx, workAreaId: number) {
  const rows = await entryQuery(db)
    .where('e.work_area_id', '=', workAreaId)
    .orderBy('e.created_at', 'desc')
    .orderBy('e.id', 'desc')
    .execute();
  const totals = await db
    .selectFrom('inventory.entry')
    .select([
      sql<string>`coalesce(sum(quantity), 0)`.as('quantity'),
      sql<string>`count(*)`.as('lines'),
      sql<string>`coalesce(sum(price_gross * quantity), 0)::numeric(14,2)`.as('gross_value'),
    ])
    .where('work_area_id', '=', workAreaId)
    .executeTakeFirstOrThrow();
  const { checkpoints, counting } = await loadCheckpoints(db, workAreaId);
  return {
    entries: rows.map((row) => ({
      ...toEntry(row),
      checkpointNumber: counting.sectionOf.get(row.id) ?? null,
    })),
    checkpoints,
    sinceLastCheckpoint: counting.sinceLastCheckpoint,
    totals: {
      quantity: Number(totals.quantity),
      lines: Number(totals.lines),
      grossValue: totals.gross_value,
    },
  };
}

/**
 * Loads a line of the workstation's work area for a change and locks it.
 * Workstations can only change lines of the area they work in.
 */
async function lockOwnAreaEntry(trx: Trx, station: StationIdentity, entryId: number) {
  const { workArea } = await lockCaptureContext(trx, station);
  const entry = await trx
    .selectFrom('inventory.entry')
    .select(['id', 'quantity', 'work_area_id', 'description', 'ean', 'input', 'serial_number'])
    .where('id', '=', entryId)
    .forUpdate()
    .executeTakeFirst();
  if (!entry || entry.work_area_id !== workArea.id) {
    throw new DomainError('not_found', 'Entry not found in the work area of this workstation');
  }
  return { entry, workArea };
}

/** An actor at a workstation, directly or with a paired phone. */
export type StationActor = Extract<AuditActor, { workstation: StationIdentity }>;

/**
 * Changes the quantity of a line; +/− are applied relative to the current
 * value. A change is recorded in the audit log.
 */
export async function updateEntryQuantity(
  { db, events }: Context,
  actor: StationActor,
  entryId: number,
  change: UpdateEntryRequest,
): Promise<Entry> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const { entry, changed } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { entry: current } = await lockOwnAreaEntry(trx, actor.workstation, entryId);
    const quantity = nextQuantity(current.quantity, change);
    if (quantity !== current.quantity) {
      await trx
        .updateTable('inventory.entry')
        .set({ quantity, updated_at: new Date() })
        .where('id', '=', entryId)
        .execute();
      await recordAudit(
        trx,
        stocktakeId,
        actor,
        entryChange('quantity_changed', current, current.quantity, quantity),
      );
    }
    return { entry: await getEntry(trx, entryId), changed: quantity !== current.quantity };
  });
  if (changed) {
    events.publish({
      type: 'entry.changed',
      action: 'updated',
      stocktakeId,
      workAreaId: entry.workAreaId,
      entryId,
    });
  }
  return entry;
}

/**
 * Sets, changes or removes (empty value) the serial number of a line. A
 * change is recorded in the audit log.
 */
export async function updateSerialNumber(
  { db, events }: Context,
  actor: StationActor,
  entryId: number,
  value: string | null,
): Promise<Entry> {
  const serialNumber = parseSerialNumber(value);
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const { entry, changed } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { entry: current } = await lockOwnAreaEntry(trx, actor.workstation, entryId);
    const changed = serialNumber !== current.serial_number;
    if (changed) {
      await trx
        .updateTable('inventory.entry')
        .set({ serial_number: serialNumber, updated_at: new Date() })
        .where('id', '=', entryId)
        .execute();
      await recordAudit(
        trx,
        stocktakeId,
        actor,
        entryChange('serial_number_changed', current, current.serial_number, serialNumber),
      );
    }
    return { entry: await getEntry(trx, entryId), changed };
  });
  if (changed) {
    events.publish({
      type: 'entry.changed',
      action: 'updated',
      stocktakeId,
      workAreaId: entry.workAreaId,
      entryId,
    });
  }
  return entry;
}

/**
 * The complete row of a line with its employees, as JSON with timestamps in
 * full precision, so that it can be restored exactly.
 */
async function entrySnapshot(trx: Trx, entryId: number): Promise<Record<string, unknown>> {
  const { rows } = await sql<{ snapshot: Record<string, unknown> }>`
    SELECT jsonb_build_object(
      'entry', to_jsonb(e),
      'employeeIds', coalesce(
        (SELECT jsonb_agg(ee.employee_id ORDER BY ee.employee_id)
         FROM inventory.entry_employee ee WHERE ee.entry_id = e.id),
        '[]'::jsonb)
    ) AS snapshot
    FROM inventory.entry e WHERE e.id = ${entryId}`.execute(trx);
  return rows[0]!.snapshot;
}

/**
 * Deletes a line. A checkpoint whose section becomes empty is removed as
 * well. The audit log keeps the line and these checkpoints.
 */
export async function deleteEntry(
  { db, events }: Context,
  actor: StationActor,
  entryId: number,
): Promise<DeleteEntryResponse> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const { workAreaId, removed } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { entry, workArea } = await lockOwnAreaEntry(trx, actor.workstation, entryId);
    await lockCheckpoints(trx, workArea.id);
    const snapshot = await entrySnapshot(trx, entryId);
    await trx.deleteFrom('inventory.entry').where('id', '=', entryId).execute();
    const removed = await removeEmptyCheckpoints(trx, workArea.id);
    await recordAudit(
      trx,
      stocktakeId,
      actor,
      entryChange('deleted', entry, entry.quantity, null),
      { ...snapshot, checkpoints: removed.map((c) => c.row) },
    );
    return { workAreaId: workArea.id, removed };
  });
  events.publish({ type: 'entry.changed', action: 'deleted', stocktakeId, workAreaId, entryId });
  for (const { id } of removed) {
    events.publish({
      type: 'checkpoint.changed',
      action: 'deleted',
      stocktakeId,
      workAreaId,
      checkpointId: id,
    });
  }
  return { removedCheckpoints: removed.map((c) => c.number) };
}

/** A deleted line as `deleteEntry` keeps it in the audit log. */
interface DeletedEntrySnapshot {
  entry: {
    id: number;
    work_area_id: number;
    workstation_id: number;
    description: string;
    ean: string | null;
    input: string;
    quantity: number;
  };
  employeeIds: number[];
  checkpoints: unknown[];
}

/**
 * Restores the line the workstation (or its phone) deleted last, with the
 * same id, capture time, employees and snapshot, so that it is back in its
 * place and checkpoint section. Checkpoints removed with it return as well.
 */
export async function restoreEntry(
  { db, events }: Context,
  actor: StationActor,
  entryId: number,
): Promise<RestoreEntryResponse> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const unavailable = (reason: string) => new DomainError('restore_unavailable', reason);
  const outcome = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea } = await lockCaptureContext(trx, actor.workstation);
    // Serializes restoring with deleting lines and changing checkpoints of the area.
    await lockCheckpoints(trx, workArea.id);
    const last = await trx
      .selectFrom('inventory.audit_log')
      .select(['action', 'entry_id', 'work_area_id', 'entry_snapshot', 'created_at'])
      .where('stocktake_id', '=', stocktakeId)
      .where('workstation_id', '=', actor.workstation.id)
      .where('action', 'in', ['deleted', 'restored'])
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    const plan = planRestore(
      last && {
        action: last.action as 'deleted' | 'restored',
        entryId: last.entry_id,
        createdAt: last.created_at,
      },
      entryId,
      new Date(),
    );
    if (plan === 'already_restored') {
      return { entry: await getEntry(trx, entryId), checkpoints: [], restored: false };
    }
    if (last!.work_area_id !== workArea.id) {
      throw unavailable('The line belongs to another work area');
    }
    const snapshot = last!.entry_snapshot as DeletedEntrySnapshot;
    const creator = await trx
      .selectFrom('inventory.workstation')
      .select('id')
      .where('id', '=', snapshot.entry.workstation_id)
      .executeTakeFirst();
    if (!creator) throw unavailable('The workstation that captured the line was deleted');

    await sql`
      INSERT INTO inventory.entry
      SELECT * FROM jsonb_populate_record(
        NULL::inventory.entry, ${JSON.stringify(snapshot.entry)}::jsonb)`.execute(trx);
    // Employees without other lines may have been deleted meanwhile.
    await sql`
      INSERT INTO inventory.entry_employee (entry_id, employee_id)
      SELECT ${entryId}, e.id FROM inventory.employee e
      WHERE e.id = ANY(${snapshot.employeeIds}::bigint[])`.execute(trx);
    const checkpoints = await restoreCheckpoints(trx, workArea.id, snapshot.checkpoints);
    await recordAudit(
      trx,
      stocktakeId,
      actor,
      entryChange('restored', snapshot.entry, null, snapshot.entry.quantity),
    );
    return { entry: await getEntry(trx, entryId), checkpoints, restored: true };
  });

  if (outcome.restored) {
    const { workAreaId } = outcome.entry;
    events.publish({ type: 'entry.changed', action: 'created', stocktakeId, workAreaId, entryId });
    for (const { id } of outcome.checkpoints) {
      events.publish({
        type: 'checkpoint.changed',
        action: 'created',
        stocktakeId,
        workAreaId,
        checkpointId: id,
      });
    }
  }
  return {
    entry: outcome.entry,
    restoredCheckpoints: outcome.checkpoints.map((c) => c.number),
  };
}

/** Captures an article that is not in the master data; the line is marked as manual. */
export async function createManualEntry(
  { db, events }: Context,
  station: StationIdentity,
  request: CreateManualEntryRequest,
): Promise<Entry> {
  const values = manualEntryValues(request);
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const findByRequestId = async (executor: Db | Trx) => {
    if (!request.requestId) return undefined;
    const existing = await executor
      .selectFrom('inventory.entry')
      .select('id')
      .where('request_id', '=', request.requestId)
      .executeTakeFirst();
    return existing && getEntry(executor, existing.id);
  };

  const outcome = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea, employeeIds } = await lockCaptureContext(trx, station);
    const existing = await findByRequestId(trx);
    if (existing) return { entry: existing, created: false };
    const { id } = await trx
      .insertInto('inventory.entry')
      .values({
        ...values,
        stocktake_id: stocktakeId,
        work_area_id: workArea.id,
        workstation_id: station.id,
        request_id: request.requestId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('inventory.entry_employee')
      .values(employeeIds.map((employee_id) => ({ entry_id: id, employee_id })))
      .execute();
    return { entry: await getEntry(trx, id), created: true };
  }).catch(async (error: unknown) => {
    // A concurrent retry with the same request id created the line first.
    const existing = isUniqueViolation(error, 'entry_request_id_key')
      ? await findByRequestId(db)
      : undefined;
    if (!existing) throw error;
    return { entry: existing, created: false };
  });

  if (outcome.created) {
    events.publish({
      type: 'entry.changed',
      action: 'created',
      stocktakeId,
      workAreaId: outcome.entry.workAreaId,
      entryId: outcome.entry.id,
    });
  }
  return outcome.entry;
}
