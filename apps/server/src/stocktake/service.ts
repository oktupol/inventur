import type { Stocktake, StocktakeSummary } from '@inventur/shared';
import type { Selectable, Transaction } from 'kysely';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import type { Database, StocktakeTable } from '../db/schema.ts';
import { DomainError } from '../errors.ts';
import { assertCanStart, assertWritable, parseStocktakeName, planFinish } from './lifecycle.ts';

export type Trx = Transaction<Database>;

function toStocktake(row: Selectable<StocktakeTable>): Stocktake {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

/** All stocktakes, newest first, with key figures for the history. */
export async function listStocktakes(db: Db): Promise<StocktakeSummary[]> {
  const rows = await db
    .selectFrom('inventory.stocktake as s')
    .selectAll('s')
    .select((eb) => [
      eb
        .selectFrom('inventory.work_area as w')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('w.stocktake_id', '=', 's.id')
        .as('work_area_count'),
      eb
        .selectFrom('inventory.work_area as w')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('w.stocktake_id', '=', 's.id')
        .where('w.status', '=', 'closed')
        .as('closed_work_area_count'),
      eb
        .selectFrom('inventory.employee as m')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('m.stocktake_id', '=', 's.id')
        .as('employee_count'),
      eb
        .selectFrom('inventory.entry as e')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('e.stocktake_id', '=', 's.id')
        .as('entry_count'),
      eb
        .selectFrom('inventory.entry as e')
        .select((sub) => sub.fn.coalesce(sub.fn.sum<number>('e.quantity'), sub.lit(0)).as('n'))
        .whereRef('e.stocktake_id', '=', 's.id')
        .as('quantity'),
    ])
    .orderBy('s.started_at', 'desc')
    .orderBy('s.id', 'desc')
    .execute();
  return rows.map((row) => ({
    ...toStocktake(row),
    workAreaCount: Number(row.work_area_count),
    closedWorkAreaCount: Number(row.closed_work_area_count),
    employeeCount: Number(row.employee_count),
    entryCount: Number(row.entry_count),
    quantity: Number(row.quantity),
  }));
}

export async function getActiveStocktake(db: Db | Trx): Promise<Stocktake | null> {
  const row = await db
    .selectFrom('inventory.stocktake')
    .selectAll()
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row ? toStocktake(row) : null;
}

export async function getStocktake(db: Db, id: number): Promise<Stocktake> {
  const row = await db
    .selectFrom('inventory.stocktake')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new DomainError('not_found', 'Stocktake not found');
  return toStocktake(row);
}

export async function startStocktake({ db, events }: Context, name: string): Promise<Stocktake> {
  const stocktakeName = parseStocktakeName(name);
  const stocktake = await db.transaction().execute(async (trx) => {
    assertCanStart((await getActiveStocktake(trx)) ?? undefined);
    try {
      const row = await trx
        .insertInto('inventory.stocktake')
        .values({ name: stocktakeName })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toStocktake(row);
    } catch (error) {
      // Another request started a stocktake at the same time.
      if (isUniqueViolation(error, 'stocktake_single_active_idx')) {
        throw new DomainError('stocktake_already_active', 'Another stocktake is already active');
      }
      throw error;
    }
  });
  events.publish({ type: 'stocktake.changed', action: 'created', stocktakeId: stocktake.id });
  return stocktake;
}

/**
 * Runs a write within a transaction while the stocktake is locked against
 * being finished concurrently. Rejects writes to finished stocktakes.
 */
export async function withWritableStocktake<T>(
  db: Db,
  stocktakeId: number,
  write: (trx: Trx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    const stocktake = await trx
      .selectFrom('inventory.stocktake')
      .select(['id', 'status'])
      .where('id', '=', stocktakeId)
      .forShare()
      .executeTakeFirst();
    assertWritable(stocktake);
    return write(trx);
  });
}

/**
 * Finishes the stocktake. Workstations leave their work areas, employees are
 * logged out and all phone pairings are disconnected.
 */
export async function finishStocktake(
  { db, events }: Context,
  id: number,
  confirmed: boolean,
): Promise<Stocktake> {
  const result = await db.transaction().execute(async (trx) => {
    const stocktake = await trx
      .selectFrom('inventory.stocktake')
      .select(['id', 'status'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    const workAreas = await trx
      .selectFrom('inventory.work_area')
      .select(['id', 'name', 'status'])
      .where('stocktake_id', '=', id)
      .orderBy('name')
      .execute();
    planFinish(stocktake, workAreas, confirmed);

    const row = await trx
      .updateTable('inventory.stocktake')
      .set({ status: 'finished', finished_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    const workAreaIds = workAreas.map((area) => area.id);
    const workstations =
      workAreaIds.length === 0
        ? []
        : await trx
            .updateTable('inventory.workstation')
            .set({ work_area_id: null })
            .where('work_area_id', 'in', workAreaIds)
            .returning('id')
            .execute();
    const employees = await trx
      .updateTable('inventory.employee')
      .set({ workstation_id: null })
      .where('stocktake_id', '=', id)
      .where('workstation_id', 'is not', null)
      .returning(['id', 'workstation_id'])
      .execute();
    // Pairings belong to workstations, not to a stocktake. Only one stocktake
    // can be active, so all current pairings end with it.
    const pairings = await trx
      .deleteFrom('inventory.pairing')
      .returning('workstation_id')
      .execute();

    const changedWorkstations = new Set([
      ...workstations.map((w) => w.id),
      ...pairings.map((p) => p.workstation_id),
    ]);
    return { stocktake: toStocktake(row), changedWorkstations, employees };
  });

  events.publish({ type: 'stocktake.changed', action: 'updated', stocktakeId: id });
  for (const employee of result.employees) {
    events.publish({
      type: 'employee.changed',
      action: 'updated',
      stocktakeId: id,
      employeeId: employee.id,
    });
  }
  for (const workstationId of result.changedWorkstations) {
    events.publish({ type: 'workstation.changed', action: 'updated', workstationId });
  }
  return result.stocktake;
}
