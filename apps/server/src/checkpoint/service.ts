import type { Checkpoint, CreateCheckpointRequest } from '@inventur/shared';
import { sql } from 'kysely';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { lockCaptureContext } from '../entry/service.ts';
import { DomainError } from '../errors.ts';
import { requireActiveStocktake } from '../station/rules.ts';
import type { StationIdentity } from '../station/service.ts';
import { getActiveStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';
import {
  countCheckpoints,
  emptyCheckpoints,
  planCheckpoint,
  type CheckpointCounting,
  type TimedCheckpoint,
  type TimedEntry,
} from './counting.ts';

/** Microseconds since the epoch, precise enough to order lines and checkpoints. */
const micros = (column: string) =>
  sql<number>`(extract(epoch from ${sql.ref(column)}) * 1000000)::bigint`;

/**
 * Serializes changes of the checkpoints and the deletion of lines of a work
 * area, so every section keeps at least one line.
 */
export async function lockCheckpoints(trx: Trx, workAreaId: number): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(2, ${workAreaId}::int)`.execute(trx);
}

async function loadTimes(
  db: Db | Trx,
  workAreaId: number,
): Promise<{ entries: TimedEntry[]; checkpoints: TimedCheckpoint[] }> {
  const [entries, checkpoints] = await Promise.all([
    db
      .selectFrom('inventory.entry')
      .select(['id', 'quantity', micros('created_at').as('at')])
      .where('work_area_id', '=', workAreaId)
      .execute(),
    db
      .selectFrom('inventory.checkpoint')
      .select(['id', micros('boundary_at').as('at')])
      .where('work_area_id', '=', workAreaId)
      .execute(),
  ]);
  return {
    entries: entries.map((e) => ({ id: e.id, at: Number(e.at), quantity: e.quantity })),
    checkpoints: checkpoints.map((c) => ({ id: c.id, at: Number(c.at) })),
  };
}

/** The checkpoints of a work area (newest first) with their counts and the section of every line. */
export async function loadCheckpoints(
  db: Db | Trx,
  workAreaId: number,
): Promise<{ checkpoints: Checkpoint[]; counting: CheckpointCounting }> {
  const [times, rows] = await Promise.all([
    loadTimes(db, workAreaId),
    db
      .selectFrom('inventory.checkpoint as c')
      .leftJoin('inventory.workstation as w', 'w.id', 'c.workstation_id')
      .select(['c.id', 'c.workstation_id', 'c.created_at', 'w.name as workstation_name'])
      .where('c.work_area_id', '=', workAreaId)
      .execute(),
  ]);
  const counting = countCheckpoints(times.entries, times.checkpoints);
  const counts = new Map(counting.checkpoints.map((c) => [c.id, c]));
  const checkpoints = rows
    .map((row) => {
      const count = counts.get(row.id)!;
      return {
        id: row.id,
        workAreaId,
        number: count.number,
        workstation:
          row.workstation_id !== null && row.workstation_name !== null
            ? { id: row.workstation_id, name: row.workstation_name }
            : null,
        createdAt: row.created_at.toISOString(),
        sinceLast: count.sinceLast,
        sinceStart: count.sinceStart,
      };
    })
    .sort((a, b) => b.number - a.number);
  return { checkpoints, counting };
}

/**
 * Sets a checkpoint in the work area of the workstation: at the end, or
 * after the line `afterEntryId`. Requires a logged-in employee, and every
 * section must keep at least one line.
 */
export async function createCheckpoint(
  { db, events }: Context,
  station: StationIdentity,
  request: CreateCheckpointRequest = {},
): Promise<Checkpoint> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const checkpoint = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea } = await lockCaptureContext(trx, station);
    await lockCheckpoints(trx, workArea.id);

    let boundary;
    if (request.afterEntryId !== undefined) {
      const entry = await trx
        .selectFrom('inventory.entry')
        .select(['created_at', micros('created_at').as('at')])
        .where('id', '=', request.afterEntryId)
        .where('work_area_id', '=', workArea.id)
        .executeTakeFirst();
      if (!entry) throw new DomainError('not_found', 'Entry not found in this work area');
      boundary = {
        at: Number(entry.at),
        value: sql<Date>`(SELECT created_at FROM inventory.entry WHERE id = ${request.afterEntryId})`,
      };
    } else {
      const { at } = await sql<{ at: string }>`
        SELECT (extract(epoch from now()) * 1000000)::bigint AS at`
        .execute(trx)
        .then((r) => r.rows[0]!);
      boundary = { at: Number(at), value: sql<Date>`now()` };
    }

    const times = await loadTimes(trx, workArea.id);
    planCheckpoint(times.entries, times.checkpoints, boundary.at);
    const { id } = await trx
      .insertInto('inventory.checkpoint')
      .values({
        work_area_id: workArea.id,
        boundary_at: boundary.value,
        workstation_id: station.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { checkpoints } = await loadCheckpoints(trx, workArea.id);
    return checkpoints.find((c) => c.id === id)!;
  });
  events.publish({
    type: 'checkpoint.changed',
    action: 'created',
    stocktakeId,
    workAreaId: checkpoint.workAreaId,
    checkpointId: checkpoint.id,
  });
  return checkpoint;
}

/** Deletes a checkpoint; the sections before and after it merge. */
export async function deleteCheckpoint(
  { db, events }: Context,
  station: StationIdentity,
  checkpointId: number,
): Promise<void> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const workAreaId = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const { workArea } = await lockCaptureContext(trx, station);
    await lockCheckpoints(trx, workArea.id);
    const deleted = await trx
      .deleteFrom('inventory.checkpoint')
      .where('id', '=', checkpointId)
      .where('work_area_id', '=', workArea.id)
      .executeTakeFirst();
    if (deleted.numDeletedRows === 0n) {
      throw new DomainError('not_found', 'Checkpoint not found in this work area');
    }
    return workArea.id;
  });
  events.publish({
    type: 'checkpoint.changed',
    action: 'deleted',
    stocktakeId,
    workAreaId,
    checkpointId,
  });
}

/**
 * Removes the checkpoints whose section became empty, e.g. after its last
 * line was deleted. Callers hold `lockCheckpoints`. Returns the removed
 * checkpoints with their numbers before the removal.
 */
export async function removeEmptyCheckpoints(
  trx: Trx,
  workAreaId: number,
): Promise<{ id: number; number: number; row: unknown }[]> {
  const times = await loadTimes(trx, workAreaId);
  const empty = emptyCheckpoints(times.entries, times.checkpoints);
  if (empty.length === 0) return [];
  // The complete rows in full precision allow restoring them exactly.
  const deleted = await trx
    .deleteFrom('inventory.checkpoint')
    .where(
      'id',
      'in',
      empty.map((c) => c.id),
    )
    .returning(['id', sql<unknown>`to_jsonb(checkpoint)`.as('row')])
    .execute();
  const rows = new Map(deleted.map((d) => [d.id, d.row]));
  return empty.map(({ id, number }) => ({ id, number, row: rows.get(id) }));
}
