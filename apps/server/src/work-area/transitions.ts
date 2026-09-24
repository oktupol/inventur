import { sql } from 'kysely';
import type { Context } from '../context.ts';
import { DomainError } from '../errors.ts';
import { requireActiveStocktake } from '../station/rules.ts';
import type { StationIdentity } from '../station/service.ts';
import { getActiveStocktake, withWritableStocktake, type Trx } from '../stocktake/service.ts';
import { nextStatus, type WorkAreaTransition } from './status.ts';

/**
 * Serializes all status transitions of work areas within a stocktake. They
 * are rare, and a single lock rules out deadlocks between a workstation
 * joining and another one closing the area.
 */
export async function lockWorkAreaTransitions(trx: Trx, stocktakeId: number): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(1, ${stocktakeId}::int)`.execute(trx);
}

/** Work areas and workstations whose state changed, for the realtime events. */
export class WorkAreaChanges {
  readonly workAreas = new Set<number>();
  readonly workstations = new Set<number>();

  publish({ events }: Context, stocktakeId: number): void {
    for (const workAreaId of this.workAreas) {
      events.publish({ type: 'work_area.changed', action: 'updated', stocktakeId, workAreaId });
    }
    for (const workstationId of this.workstations) {
      events.publish({ type: 'workstation.changed', action: 'updated', workstationId });
    }
  }
}

async function getWorkArea(trx: Trx, stocktakeId: number, workAreaId: number) {
  const area = await trx
    .selectFrom('inventory.work_area')
    .select(['id', 'status'])
    .where('id', '=', workAreaId)
    .where('stocktake_id', '=', stocktakeId)
    .executeTakeFirst();
  if (!area) throw new DomainError('not_found', 'Work area not found');
  return area;
}

async function applyTransition(
  trx: Trx,
  area: { id: number; status: 'open' | 'in_progress' | 'closed' },
  transition: WorkAreaTransition,
  changes: WorkAreaChanges,
): Promise<void> {
  const status = nextStatus(area.status, transition);
  if (status === area.status) return;
  await trx
    .updateTable('inventory.work_area')
    .set({ status, closed_at: status === 'closed' ? new Date() : null })
    .where('id', '=', area.id)
    .execute();
  changes.workAreas.add(area.id);
}

async function remainingWorkstations(trx: Trx, workAreaId: number): Promise<number> {
  const { n } = await trx
    .selectFrom('inventory.workstation')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('work_area_id', '=', workAreaId)
    .executeTakeFirstOrThrow();
  return Number(n);
}

/**
 * Takes the workstation out of its work area; the area falls back to open
 * when the last workstation leaves. Callers must hold the transition lock.
 */
export async function leaveCurrentWorkArea(
  trx: Trx,
  stocktakeId: number,
  workstationId: number,
  changes: WorkAreaChanges,
): Promise<void> {
  const workstation = await trx
    .selectFrom('inventory.workstation')
    .select('work_area_id')
    .where('id', '=', workstationId)
    .executeTakeFirstOrThrow();
  if (workstation.work_area_id === null) return;
  await trx
    .updateTable('inventory.workstation')
    .set({ work_area_id: null })
    .where('id', '=', workstationId)
    .execute();
  changes.workstations.add(workstationId);
  changes.workAreas.add(workstation.work_area_id);
  const area = await getWorkArea(trx, stocktakeId, workstation.work_area_id);
  await applyTransition(
    trx,
    area,
    { type: 'leave', remainingWorkstations: await remainingWorkstations(trx, area.id) },
    changes,
  );
}

async function inActiveStocktake(
  context: Context,
  write: (trx: Trx, stocktakeId: number, changes: WorkAreaChanges) => Promise<void>,
): Promise<void> {
  const stocktakeId = requireActiveStocktake(await getActiveStocktake(context.db)).id;
  const changes = new WorkAreaChanges();
  await withWritableStocktake(context.db, stocktakeId, async (trx) => {
    await lockWorkAreaTransitions(trx, stocktakeId);
    await write(trx, stocktakeId, changes);
  });
  changes.publish(context, stocktakeId);
}

/** The workstation joins a work area, leaving its previous one. Closed areas cannot be joined. */
export function joinWorkArea(
  context: Context,
  station: StationIdentity,
  workAreaId: number,
): Promise<void> {
  return inActiveStocktake(context, async (trx, stocktakeId, changes) => {
    const area = await getWorkArea(trx, stocktakeId, workAreaId);
    nextStatus(area.status, { type: 'join' });
    const { work_area_id } = await trx
      .selectFrom('inventory.workstation')
      .select('work_area_id')
      .where('id', '=', station.id)
      .executeTakeFirstOrThrow();
    if (work_area_id === workAreaId) return;
    await leaveCurrentWorkArea(trx, stocktakeId, station.id, changes);
    await trx
      .updateTable('inventory.workstation')
      .set({ work_area_id: workAreaId })
      .where('id', '=', station.id)
      .execute();
    changes.workstations.add(station.id);
    changes.workAreas.add(workAreaId);
    await applyTransition(trx, area, { type: 'join' }, changes);
  });
}

export function leaveWorkArea(context: Context, station: StationIdentity): Promise<void> {
  return inActiveStocktake(context, (trx, stocktakeId, changes) =>
    leaveCurrentWorkArea(trx, stocktakeId, station.id, changes),
  );
}

/**
 * Closes a work area; all workstations leave it. A workstation can only close
 * the area it works in, the administrator (without `station`) any area.
 */
export async function closeWorkArea(
  context: Context,
  stocktakeId: number,
  workAreaId: number,
  station?: StationIdentity,
): Promise<void> {
  const changes = new WorkAreaChanges();
  await withWritableStocktake(context.db, stocktakeId, async (trx) => {
    await lockWorkAreaTransitions(trx, stocktakeId);
    const area = await getWorkArea(trx, stocktakeId, workAreaId);
    const workstations = await trx
      .updateTable('inventory.workstation')
      .set({ work_area_id: null })
      .where('work_area_id', '=', workAreaId)
      .returning('id')
      .execute();
    if (station && !workstations.some((w) => w.id === station.id)) {
      throw new DomainError('not_in_work_area', 'Workstation is not in this work area');
    }
    for (const { id } of workstations) changes.workstations.add(id);
    if (workstations.length > 0) changes.workAreas.add(workAreaId);
    await applyTransition(trx, area, { type: 'close' }, changes);
  });
  changes.publish(context, stocktakeId);
}

/** Reopens a closed work area; it becomes in progress again once a workstation joins. */
export async function reopenWorkArea(
  context: Context,
  stocktakeId: number,
  workAreaId: number,
): Promise<void> {
  const changes = new WorkAreaChanges();
  await withWritableStocktake(context.db, stocktakeId, async (trx) => {
    await lockWorkAreaTransitions(trx, stocktakeId);
    const area = await getWorkArea(trx, stocktakeId, workAreaId);
    await applyTransition(trx, area, { type: 'reopen' }, changes);
  });
  changes.publish(context, stocktakeId);
}
