import { randomBytes } from 'node:crypto';
import type {
  NamedRef,
  StationEmployee,
  StationState,
  WorkstationRegistration,
} from '@inventur/shared';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { DomainError } from '../errors.ts';
import { assertNameAvailable, parseName } from '../management/rules.ts';
import { getActiveStocktake, withWritableStocktake } from '../stocktake/service.ts';
import { assertLoggedInHere, checkLogin, requireActiveStocktake } from './rules.ts';

/** The authenticated workstation of a request. */
export type StationIdentity = NamedRef;

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Resolves a workstation token and records that the workstation was seen.
 * Rejects unknown tokens, e.g. after the workstation was deleted or taken over.
 */
export async function authenticate(db: Db, token: string | undefined): Promise<StationIdentity> {
  const workstation = token
    ? await db
        .updateTable('inventory.workstation')
        .set({ last_seen_at: new Date() })
        .where('token', '=', token)
        .returning(['id', 'name'])
        .executeTakeFirst()
    : undefined;
  if (!workstation) throw new DomainError('workstation_unknown', 'Unknown workstation token');
  return workstation;
}

export async function registerWorkstation(
  { db, events }: Context,
  rawName: string,
): Promise<WorkstationRegistration> {
  const name = parseName(rawName, 'Workstation');
  const token = generateToken();
  const workstation = await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('inventory.workstation').select(['id', 'name']).execute();
    assertNameAvailable(name, existing, 'Workstation');
    return trx
      .insertInto('inventory.workstation')
      .values({ name, token, last_seen_at: new Date() })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        throw isUniqueViolation(error, 'workstation_name_key')
          ? new DomainError('name_taken', `Workstation "${name}" already exists`)
          : error;
      });
  });
  events.publish({ type: 'workstation.changed', action: 'created', workstationId: workstation.id });
  return { token, workstation };
}

/** Names of all workstations, for taking over an existing one. */
export function listWorkstationNames(db: Db): Promise<NamedRef[]> {
  return db.selectFrom('inventory.workstation').select(['id', 'name']).orderBy('name').execute();
}

/**
 * Continues as an existing workstation in a new browser. The token is
 * replaced, so a browser that still uses the old one has to register again.
 */
export async function takeOverWorkstation(
  { db, events }: Context,
  workstationId: number,
): Promise<WorkstationRegistration> {
  const token = generateToken();
  const workstation = await db
    .updateTable('inventory.workstation')
    .set({ token, last_seen_at: new Date() })
    .where('id', '=', workstationId)
    .returning(['id', 'name'])
    .executeTakeFirst();
  if (!workstation) throw new DomainError('not_found', 'Workstation not found');
  events.publish({ type: 'workstation.changed', action: 'updated', workstationId });
  return { token, workstation };
}

export async function getStationState(db: Db, station: StationIdentity): Promise<StationState> {
  const stocktake = await getActiveStocktake(db);
  const employees = stocktake
    ? await db
        .selectFrom('inventory.employee')
        .select(['id', 'name'])
        .where('stocktake_id', '=', stocktake.id)
        .where('workstation_id', '=', station.id)
        .orderBy('name')
        .execute()
    : [];
  const workArea = await db
    .selectFrom('inventory.workstation as w')
    .innerJoin('inventory.work_area as a', 'a.id', 'w.work_area_id')
    .select(['a.id', 'a.name', 'a.status'])
    .where('w.id', '=', station.id)
    .executeTakeFirst();
  return {
    workstation: station,
    stocktake: stocktake && { id: stocktake.id, name: stocktake.name },
    employees,
    workArea: workArea ?? null,
  };
}

/** Employees of the active stocktake with the workstation they are logged in to. */
export async function listStationEmployees(db: Db): Promise<StationEmployee[]> {
  const stocktake = requireActiveStocktake(await getActiveStocktake(db));
  const rows = await db
    .selectFrom('inventory.employee as m')
    .leftJoin('inventory.workstation as w', 'w.id', 'm.workstation_id')
    .select(['m.id', 'm.name', 'm.workstation_id', 'w.name as workstation_name'])
    .where('m.stocktake_id', '=', stocktake.id)
    .orderBy('m.name')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workstation:
      row.workstation_id !== null && row.workstation_name !== null
        ? { id: row.workstation_id, name: row.workstation_name }
        : null,
  }));
}

async function activeStocktakeId(db: Db): Promise<number> {
  return requireActiveStocktake(await getActiveStocktake(db)).id;
}

export async function loginEmployee(
  { db, events }: Context,
  station: StationIdentity,
  employeeId: number,
): Promise<void> {
  const stocktakeId = await activeStocktakeId(db);
  const changed = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const employee = await trx
      .selectFrom('inventory.employee')
      .select('workstation_id')
      .where('id', '=', employeeId)
      .where('stocktake_id', '=', stocktakeId)
      .forUpdate()
      .executeTakeFirst();
    if (!employee) throw new DomainError('not_found', 'Employee not found');
    if (!checkLogin(employee.workstation_id, station.id)) return false;
    await trx
      .updateTable('inventory.employee')
      .set({ workstation_id: station.id })
      .where('id', '=', employeeId)
      .execute();
    return true;
  });
  if (changed) {
    events.publish({ type: 'employee.changed', action: 'updated', stocktakeId, employeeId });
    events.publish({ type: 'workstation.changed', action: 'updated', workstationId: station.id });
  }
}

export async function logoutEmployeeAtStation(
  { db, events }: Context,
  station: StationIdentity,
  employeeId: number,
): Promise<void> {
  const stocktakeId = await activeStocktakeId(db);
  await withWritableStocktake(db, stocktakeId, async (trx) => {
    const employee = await trx
      .selectFrom('inventory.employee')
      .select('workstation_id')
      .where('id', '=', employeeId)
      .where('stocktake_id', '=', stocktakeId)
      .forUpdate()
      .executeTakeFirst();
    if (!employee) throw new DomainError('not_found', 'Employee not found');
    assertLoggedInHere(employee.workstation_id, station.id);
    await trx
      .updateTable('inventory.employee')
      .set({ workstation_id: null })
      .where('id', '=', employeeId)
      .execute();
  });
  events.publish({ type: 'employee.changed', action: 'updated', stocktakeId, employeeId });
  events.publish({ type: 'workstation.changed', action: 'updated', workstationId: station.id });
}
