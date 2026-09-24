import type { Checkpoint } from '@inventur/shared';
import { sql } from 'kysely';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { DomainError } from '../errors.ts';
import { requireActiveStocktake } from '../station/rules.ts';
import type { StationIdentity } from '../station/service.ts';
import { getActiveStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';
import { acceptsEntries } from '../work-area/status.ts';
import { countCheckpoints, nextCheckpointNumber, type CheckpointCounting } from './counting.ts';

/** Creation time in microseconds, precise enough to order lines and checkpoints. */
const micros = sql<number>`(extract(epoch from created_at) * 1000000)::bigint`;

/** The checkpoints of a work area (newest first) with their counts and the section of every line. */
export async function loadCheckpoints(
  db: Db | Trx,
  workAreaId: number,
): Promise<{ checkpoints: Checkpoint[]; counting: CheckpointCounting }> {
  const [entries, rows] = await Promise.all([
    db
      .selectFrom('inventory.entry')
      .select(['id', 'quantity', micros.as('at')])
      .where('work_area_id', '=', workAreaId)
      .execute(),
    db
      .selectFrom('inventory.checkpoint as c')
      .leftJoin('inventory.workstation as w', 'w.id', 'c.workstation_id')
      .select([
        'c.id',
        'c.number',
        'c.workstation_id',
        'c.created_at',
        'w.name as workstation_name',
        sql<number>`(extract(epoch from c.created_at) * 1000000)::bigint`.as('at'),
      ])
      .where('c.work_area_id', '=', workAreaId)
      .execute(),
  ]);
  const counting = countCheckpoints(
    entries.map((e) => ({ id: e.id, at: Number(e.at), quantity: e.quantity })),
    rows.map((r) => ({ id: r.id, number: r.number, at: Number(r.at) })),
  );
  const counts = new Map(counting.checkpoints.map((c) => [c.id, c]));
  const checkpoints = rows
    .map((row) => ({
      id: row.id,
      workAreaId,
      number: row.number,
      workstation:
        row.workstation_id !== null && row.workstation_name !== null
          ? { id: row.workstation_id, name: row.workstation_name }
          : null,
      createdAt: row.created_at.toISOString(),
      sinceLast: counts.get(row.id)!.sinceLast,
      sinceStart: counts.get(row.id)!.sinceStart,
    }))
    .sort((a, b) => b.number - a.number);
  return { checkpoints, counting };
}

/**
 * Sets a checkpoint in the work area of the workstation. Any workstation in
 * the area can do so at any time while the area is not closed.
 */
export async function createCheckpoint(
  { db, events }: Context,
  station: StationIdentity,
): Promise<Checkpoint> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(db)).id;
  const checkpoint = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const workArea = await trx
      .selectFrom('inventory.workstation as w')
      .innerJoin('inventory.work_area as a', 'a.id', 'w.work_area_id')
      .select(['a.id', 'a.status'])
      .where('w.id', '=', station.id)
      .forShare()
      .executeTakeFirst();
    if (!workArea) throw new DomainError('no_work_area', 'Workstation is not in a work area');
    if (!acceptsEntries(workArea.status)) {
      throw new DomainError('work_area_closed', 'Work area is closed');
    }
    // Serializes concurrent checkpoints of the same area for consecutive numbers.
    await sql`SELECT pg_advisory_xact_lock(2, ${workArea.id}::int)`.execute(trx);
    const existing = await trx
      .selectFrom('inventory.checkpoint')
      .select('number')
      .where('work_area_id', '=', workArea.id)
      .execute();
    const { id } = await trx
      .insertInto('inventory.checkpoint')
      .values({
        work_area_id: workArea.id,
        number: nextCheckpointNumber(existing.map((c) => c.number)),
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
