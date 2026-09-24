import type { Employee, ImportResponse } from '@inventur/shared';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { DomainError } from '../errors.ts';
import {
  assertDeletable,
  assertNameAvailable,
  parseName,
  selectForImport,
} from '../management/rules.ts';
import { getPreviousStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';

function employeeQuery(db: Db | Trx) {
  return db
    .selectFrom('inventory.employee as m')
    .leftJoin('inventory.workstation as w', 'w.id', 'm.workstation_id')
    .select((eb) => [
      'm.id',
      'm.stocktake_id',
      'm.name',
      'm.workstation_id',
      'w.name as workstation_name',
      eb
        .selectFrom('inventory.entry_employee as ee')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('ee.employee_id', '=', 'm.id')
        .as('entry_count'),
    ]);
}

type EmployeeRow = Awaited<ReturnType<ReturnType<typeof employeeQuery>['executeTakeFirstOrThrow']>>;

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    stocktakeId: row.stocktake_id,
    name: row.name,
    workstation:
      row.workstation_id !== null && row.workstation_name !== null
        ? { id: row.workstation_id, name: row.workstation_name }
        : null,
    entryCount: Number(row.entry_count),
  };
}

export async function listEmployees(db: Db, stocktakeId: number): Promise<Employee[]> {
  const rows = await employeeQuery(db)
    .where('m.stocktake_id', '=', stocktakeId)
    .orderBy('m.name')
    .execute();
  return rows.map(toEmployee);
}

async function getEmployee(db: Db | Trx, stocktakeId: number, id: number): Promise<Employee> {
  const row = await employeeQuery(db)
    .where('m.stocktake_id', '=', stocktakeId)
    .where('m.id', '=', id)
    .executeTakeFirst();
  if (!row) throw new DomainError('not_found', 'Employee not found');
  return toEmployee(row);
}

async function existingNames(trx: Trx, stocktakeId: number) {
  return trx
    .selectFrom('inventory.employee')
    .select(['id', 'name'])
    .where('stocktake_id', '=', stocktakeId)
    .execute();
}

function nameTaken(name: string) {
  return (error: unknown): never => {
    throw isUniqueViolation(error, 'employee_stocktake_id_name_key')
      ? new DomainError('name_taken', `Employee "${name}" already exists`)
      : error;
  };
}

export async function createEmployee(
  { db, events }: Context,
  stocktakeId: number,
  rawName: string,
): Promise<Employee> {
  const name = parseName(rawName, 'Employee');
  const employee = await withWritableStocktake(db, stocktakeId, async (trx) => {
    assertNameAvailable(name, await existingNames(trx, stocktakeId), 'Employee');
    const { id } = await trx
      .insertInto('inventory.employee')
      .values({ stocktake_id: stocktakeId, name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .catch(nameTaken(name));
    return getEmployee(trx, stocktakeId, id);
  });
  events.publish({
    type: 'employee.changed',
    action: 'created',
    stocktakeId,
    employeeId: employee.id,
  });
  return employee;
}

/** Removes an employee without entries; this also logs them out of their workstation. */
export async function deleteEmployee(
  { db, events }: Context,
  stocktakeId: number,
  id: number,
): Promise<void> {
  const employee = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const current = await getEmployee(trx, stocktakeId, id);
    assertDeletable(current.entryCount, 'Employee');
    await trx.deleteFrom('inventory.employee').where('id', '=', id).execute();
    return current;
  });
  events.publish({ type: 'employee.changed', action: 'deleted', stocktakeId, employeeId: id });
  if (employee.workstation) {
    events.publish({
      type: 'workstation.changed',
      action: 'updated',
      workstationId: employee.workstation.id,
    });
  }
}

/** Logs an employee out of their workstation, e.g. when the computer was switched off. */
export async function logoutEmployee(
  { db, events }: Context,
  stocktakeId: number,
  id: number,
): Promise<Employee> {
  const { before, after } = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const before = await getEmployee(trx, stocktakeId, id);
    await trx
      .updateTable('inventory.employee')
      .set({ workstation_id: null })
      .where('id', '=', id)
      .execute();
    return { before, after: { ...before, workstation: null } };
  });
  if (before.workstation) {
    events.publish({ type: 'employee.changed', action: 'updated', stocktakeId, employeeId: id });
    events.publish({
      type: 'workstation.changed',
      action: 'updated',
      workstationId: before.workstation.id,
    });
  }
  return after;
}

/** Copies the employees of the previous stocktake whose names do not exist yet. */
export async function importEmployees(
  { db, events }: Context,
  stocktakeId: number,
): Promise<ImportResponse<Employee>> {
  const result = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const source = await getPreviousStocktake(trx, stocktakeId);
    const previous = await trx
      .selectFrom('inventory.employee')
      .select('name')
      .where('stocktake_id', '=', source.id)
      .orderBy('name')
      .execute();
    const selected = selectForImport(previous, await existingNames(trx, stocktakeId));
    if (selected.length === 0) return { source, created: [] };
    const inserted = await trx
      .insertInto('inventory.employee')
      .values(selected.map(({ name }) => ({ stocktake_id: stocktakeId, name })))
      .returning('id')
      .execute();
    const ids = inserted.map((row) => row.id);
    const rows = await employeeQuery(trx).where('m.id', 'in', ids).orderBy('m.name').execute();
    return { source, created: rows.map(toEmployee) };
  });
  for (const employee of result.created) {
    events.publish({
      type: 'employee.changed',
      action: 'created',
      stocktakeId,
      employeeId: employee.id,
    });
  }
  return result;
}
