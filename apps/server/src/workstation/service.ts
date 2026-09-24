import type { Workstation } from '@inventur/shared';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { DomainError } from '../errors.ts';
import { assertDeletable, assertNameAvailable, parseName } from '../management/rules.ts';
import type { Trx } from '../stocktake/service.ts';
import { statusAfterLeave } from '../work-area/status.ts';

async function loadWorkstations(db: Db | Trx, id?: number): Promise<Workstation[]> {
  let query = db
    .selectFrom('inventory.workstation as w')
    .leftJoin('inventory.work_area as a', 'a.id', 'w.work_area_id')
    .select((eb) => [
      'w.id',
      'w.name',
      'w.work_area_id',
      'w.last_seen_at',
      'a.name as work_area_name',
      eb
        .selectFrom('inventory.entry as e')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('e.workstation_id', '=', 'w.id')
        .as('entry_count'),
    ]);
  if (id !== undefined) query = query.where('w.id', '=', id);
  const rows = await query.orderBy('w.name').execute();
  if (rows.length === 0) return [];

  const employees = await db
    .selectFrom('inventory.employee')
    .select(['id', 'name', 'workstation_id'])
    .where(
      'workstation_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('name')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workArea:
      row.work_area_id !== null && row.work_area_name !== null
        ? { id: row.work_area_id, name: row.work_area_name }
        : null,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    employees: employees
      .filter((e) => e.workstation_id === row.id)
      .map(({ id, name }) => ({ id, name })),
    entryCount: Number(row.entry_count),
  }));
}

export function listWorkstations(db: Db): Promise<Workstation[]> {
  return loadWorkstations(db);
}

async function getWorkstation(db: Db | Trx, id: number): Promise<Workstation> {
  const [workstation] = await loadWorkstations(db, id);
  if (!workstation) throw new DomainError('not_found', 'Workstation not found');
  return workstation;
}

export async function renameWorkstation(
  { db, events }: Context,
  id: number,
  rawName: string,
): Promise<Workstation> {
  const name = parseName(rawName, 'Workstation');
  const workstation = await db.transaction().execute(async (trx) => {
    await getWorkstation(trx, id);
    const existing = await trx.selectFrom('inventory.workstation').select(['id', 'name']).execute();
    assertNameAvailable(name, existing, 'Workstation', id);
    await trx
      .updateTable('inventory.workstation')
      .set({ name })
      .where('id', '=', id)
      .execute()
      .catch((error: unknown) => {
        throw isUniqueViolation(error, 'workstation_name_key')
          ? new DomainError('name_taken', `Workstation "${name}" already exists`)
          : error;
      });
    return getWorkstation(trx, id);
  });
  events.publish({ type: 'workstation.changed', action: 'updated', workstationId: id });
  if (workstation.workArea) {
    // Work area lists show the names of the workstations in them.
    const { stocktake_id } = await db
      .selectFrom('inventory.work_area')
      .select('stocktake_id')
      .where('id', '=', workstation.workArea.id)
      .executeTakeFirstOrThrow();
    events.publish({
      type: 'work_area.changed',
      action: 'updated',
      stocktakeId: stocktake_id,
      workAreaId: workstation.workArea.id,
    });
  }
  return workstation;
}

/**
 * Deletes a workstation that has no entries in any stocktake. Logged-in
 * employees are logged out, and the workstation leaves its work area.
 */
export async function deleteWorkstation({ db, events }: Context, id: number): Promise<void> {
  const result = await db.transaction().execute(async (trx) => {
    const workstation = await getWorkstation(trx, id);
    assertDeletable(workstation.entryCount, 'Workstation');
    const employees = await trx
      .selectFrom('inventory.employee')
      .select(['id', 'stocktake_id'])
      .where('workstation_id', '=', id)
      .execute();
    await trx.deleteFrom('inventory.workstation').where('id', '=', id).execute();

    let workArea: { id: number; stocktake_id: number } | undefined;
    if (workstation.workArea) {
      const area = await trx
        .selectFrom('inventory.work_area')
        .select(['id', 'stocktake_id', 'status'])
        .where('id', '=', workstation.workArea.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const remaining = await trx
        .selectFrom('inventory.workstation')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('work_area_id', '=', area.id)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('inventory.work_area')
        .set({ status: statusAfterLeave(area.status, Number(remaining.n)) })
        .where('id', '=', area.id)
        .execute();
      workArea = { id: area.id, stocktake_id: area.stocktake_id };
    }
    return { employees, workArea };
  });

  events.publish({ type: 'workstation.changed', action: 'deleted', workstationId: id });
  for (const employee of result.employees) {
    events.publish({
      type: 'employee.changed',
      action: 'updated',
      stocktakeId: employee.stocktake_id,
      employeeId: employee.id,
    });
  }
  if (result.workArea) {
    events.publish({
      type: 'work_area.changed',
      action: 'updated',
      stocktakeId: result.workArea.stocktake_id,
      workAreaId: result.workArea.id,
    });
  }
}
