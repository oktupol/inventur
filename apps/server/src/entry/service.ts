import type {
  CreateEntryRequest,
  CreateEntryResponse,
  CreateManualEntryRequest,
  DeleteEntryResponse,
  Entry,
  EntryListResponse,
  UpdateEntryRequest,
} from '@inventur/shared';
import { sql } from 'kysely';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { loadCheckpoints, lockCheckpoints, removeEmptyCheckpoints } from '../checkpoint/service.ts';
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
    .select(['id', 'quantity', 'work_area_id'])
    .where('id', '=', entryId)
    .forUpdate()
    .executeTakeFirst();
  if (!entry || entry.work_area_id !== workArea.id) {
    throw new DomainError('not_found', 'Entry not found in the work area of this workstation');
  }
  return { entry, workArea };
}

/** Changes the quantity of a line; +/− are applied relative to the current value. */
export async function updateEntryQuantity(
  { db, events }: Context,
  station: StationIdentity,
  entryId: number,
  change: UpdateEntryRequest,
): Promise<Entry> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const { entry, changed } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { entry: current } = await lockOwnAreaEntry(trx, station, entryId);
    const quantity = nextQuantity(current.quantity, change);
    if (quantity !== current.quantity) {
      await trx
        .updateTable('inventory.entry')
        .set({ quantity, updated_at: new Date() })
        .where('id', '=', entryId)
        .execute();
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
 * Deletes a line permanently; there is no undo. A checkpoint whose section
 * becomes empty is removed as well.
 */
export async function deleteEntry(
  { db, events }: Context,
  station: StationIdentity,
  entryId: number,
): Promise<DeleteEntryResponse> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const { workAreaId, removed } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea } = await lockOwnAreaEntry(trx, station, entryId);
    await lockCheckpoints(trx, workArea.id);
    await trx.deleteFrom('inventory.entry').where('id', '=', entryId).execute();
    return { workAreaId: workArea.id, removed: await removeEmptyCheckpoints(trx, workArea.id) };
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
