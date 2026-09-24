import type {
  CreateWorkAreaRequest,
  ImportResponse,
  UpdateWorkAreaRequest,
  WorkArea,
} from '@inventur/shared';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { DomainError } from '../errors.ts';
import {
  assertDeletable,
  assertNameAvailable,
  parseDescription,
  parseName,
  selectForImport,
} from '../management/rules.ts';
import { getPreviousStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';

async function loadWorkAreas(
  db: Db | Trx,
  stocktakeId: number,
  ids?: readonly number[],
): Promise<WorkArea[]> {
  let query = db
    .selectFrom('inventory.work_area as a')
    .selectAll('a')
    .select((eb) => [
      eb
        .selectFrom('inventory.entry as e')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('e.work_area_id', '=', 'a.id')
        .as('entry_count'),
      eb
        .selectFrom('inventory.entry as e')
        .select((sub) => sub.fn.coalesce(sub.fn.sum<number>('e.quantity'), sub.lit(0)).as('n'))
        .whereRef('e.work_area_id', '=', 'a.id')
        .as('quantity'),
    ])
    .where('a.stocktake_id', '=', stocktakeId);
  if (ids) {
    if (ids.length === 0) return [];
    query = query.where('a.id', 'in', ids);
  }
  const rows = await query.orderBy('a.name').execute();
  if (rows.length === 0) return [];

  const workstations = await db
    .selectFrom('inventory.workstation')
    .select(['id', 'name', 'work_area_id'])
    .where(
      'work_area_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('name')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    stocktakeId: row.stocktake_id,
    name: row.name,
    description: row.description,
    status: row.status,
    closedAt: row.closed_at?.toISOString() ?? null,
    entryCount: Number(row.entry_count),
    quantity: Number(row.quantity),
    workstations: workstations
      .filter((w) => w.work_area_id === row.id)
      .map(({ id, name }) => ({ id, name })),
  }));
}

export function listWorkAreas(db: Db, stocktakeId: number): Promise<WorkArea[]> {
  return loadWorkAreas(db, stocktakeId);
}

async function getWorkArea(db: Db | Trx, stocktakeId: number, id: number): Promise<WorkArea> {
  const [workArea] = await loadWorkAreas(db, stocktakeId, [id]);
  if (!workArea) throw new DomainError('not_found', 'Work area not found');
  return workArea;
}

async function existingNames(trx: Trx, stocktakeId: number) {
  return trx
    .selectFrom('inventory.work_area')
    .select(['id', 'name'])
    .where('stocktake_id', '=', stocktakeId)
    .execute();
}

function nameTaken(name: string) {
  return (error: unknown): never => {
    throw isUniqueViolation(error, 'work_area_stocktake_id_name_key')
      ? new DomainError('name_taken', `Work area "${name}" already exists`)
      : error;
  };
}

export async function createWorkArea(
  { db, events }: Context,
  stocktakeId: number,
  request: CreateWorkAreaRequest,
): Promise<WorkArea> {
  const name = parseName(request.name, 'Work area');
  const description = parseDescription(request.description);
  const workArea = await withWritableStocktake(db, stocktakeId, async (trx) => {
    assertNameAvailable(name, await existingNames(trx, stocktakeId), 'Work area');
    const { id } = await trx
      .insertInto('inventory.work_area')
      .values({ stocktake_id: stocktakeId, name, description })
      .returning('id')
      .executeTakeFirstOrThrow()
      .catch(nameTaken(name));
    return getWorkArea(trx, stocktakeId, id);
  });
  events.publish({
    type: 'work_area.changed',
    action: 'created',
    stocktakeId,
    workAreaId: workArea.id,
  });
  return workArea;
}

/** Renames a work area or changes its description. */
export async function updateWorkArea(
  { db, events }: Context,
  stocktakeId: number,
  id: number,
  request: UpdateWorkAreaRequest,
): Promise<WorkArea> {
  const name = request.name === undefined ? undefined : parseName(request.name, 'Work area');
  const description =
    request.description === undefined ? undefined : parseDescription(request.description);
  const workArea = await withWritableStocktake(db, stocktakeId, async (trx) => {
    await getWorkArea(trx, stocktakeId, id);
    if (name !== undefined) {
      assertNameAvailable(name, await existingNames(trx, stocktakeId), 'Work area', id);
    }
    if (name !== undefined || description !== undefined) {
      await trx
        .updateTable('inventory.work_area')
        .set({ name, description })
        .where('id', '=', id)
        .execute()
        .catch(nameTaken(name ?? ''));
    }
    return getWorkArea(trx, stocktakeId, id);
  });
  events.publish({ type: 'work_area.changed', action: 'updated', stocktakeId, workAreaId: id });
  return workArea;
}

/** Deletes a work area without entries; workstations in it leave the area. */
export async function deleteWorkArea(
  { db, events }: Context,
  stocktakeId: number,
  id: number,
): Promise<void> {
  const workArea = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const current = await getWorkArea(trx, stocktakeId, id);
    assertDeletable(current.entryCount, 'Work area');
    await trx.deleteFrom('inventory.work_area').where('id', '=', id).execute();
    return current;
  });
  events.publish({ type: 'work_area.changed', action: 'deleted', stocktakeId, workAreaId: id });
  for (const workstation of workArea.workstations) {
    events.publish({
      type: 'workstation.changed',
      action: 'updated',
      workstationId: workstation.id,
    });
  }
}

/** Copies name and description of the previous stocktake's work areas whose names do not exist yet. */
export async function importWorkAreas(
  { db, events }: Context,
  stocktakeId: number,
): Promise<ImportResponse<WorkArea>> {
  const result = await withWritableStocktake(db, stocktakeId, async (trx) => {
    const source = await getPreviousStocktake(trx, stocktakeId);
    const previous = await trx
      .selectFrom('inventory.work_area')
      .select(['name', 'description'])
      .where('stocktake_id', '=', source.id)
      .orderBy('name')
      .execute();
    const selected = selectForImport(previous, await existingNames(trx, stocktakeId));
    if (selected.length === 0) return { source, created: [] };
    const inserted = await trx
      .insertInto('inventory.work_area')
      .values(
        selected.map(({ name, description }) => ({ stocktake_id: stocktakeId, name, description })),
      )
      .returning('id')
      .execute();
    const created = await loadWorkAreas(
      trx,
      stocktakeId,
      inserted.map((row) => row.id),
    );
    return { source, created };
  });
  for (const workArea of result.created) {
    events.publish({
      type: 'work_area.changed',
      action: 'created',
      stocktakeId,
      workAreaId: workArea.id,
    });
  }
  return result;
}
