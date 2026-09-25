import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { DomainError } from '../errors.ts';
import { safeFileName } from '../http/download.ts';
import { getStocktake } from '../stocktake/service.ts';
import { buildWorkAreaCountList, type WorkAreaCountList } from './model.ts';
import { renderCountList } from './render.ts';

/** Microseconds since the epoch, as the checkpoints compare them. */
const micros = (column: string) =>
  sql<string>`(extract(epoch from ${sql.ref(column)}) * 1000000)::bigint`;

async function loadWorkAreaCountLists(
  db: Db,
  stocktakeId: number,
  workAreaId: number | undefined,
): Promise<WorkAreaCountList[]> {
  const [areas, lines, checkpoints, employees] = await Promise.all([
    db
      .selectFrom('inventory.work_area')
      .select(['id', 'name', 'description', 'status'])
      .where('stocktake_id', '=', stocktakeId)
      .$if(workAreaId !== undefined, (query) => query.where('id', '=', workAreaId!))
      .execute(),
    db
      .selectFrom('inventory.entry as e')
      .innerJoin('inventory.workstation as w', 'w.id', 'e.workstation_id')
      .select([
        'e.id',
        'e.work_area_id',
        micros('e.created_at').as('at'),
        'e.created_at',
        'e.description',
        'e.ean',
        'e.input',
        'e.serial_number',
        'e.quantity',
        'e.price_net',
        'e.price_gross',
        'e.is_manual',
        'w.name as workstation',
      ])
      .where('e.stocktake_id', '=', stocktakeId)
      .$if(workAreaId !== undefined, (query) => query.where('e.work_area_id', '=', workAreaId!))
      .execute(),
    db
      .selectFrom('inventory.checkpoint as c')
      .innerJoin('inventory.work_area as a', 'a.id', 'c.work_area_id')
      .leftJoin('inventory.workstation as w', 'w.id', 'c.workstation_id')
      .select([
        'c.id',
        'c.work_area_id',
        micros('c.boundary_at').as('at'),
        'c.created_at',
        'w.name as workstation',
      ])
      .where('a.stocktake_id', '=', stocktakeId)
      .$if(workAreaId !== undefined, (query) => query.where('c.work_area_id', '=', workAreaId!))
      .execute(),
    // Employees who were logged in when lines of the area were captured.
    db
      .selectFrom('inventory.entry as e')
      .innerJoin('inventory.entry_employee as ee', 'ee.entry_id', 'e.id')
      .innerJoin('inventory.employee as m', 'm.id', 'ee.employee_id')
      .select(['e.work_area_id', 'm.name'])
      .distinct()
      .where('e.stocktake_id', '=', stocktakeId)
      .$if(workAreaId !== undefined, (query) => query.where('e.work_area_id', '=', workAreaId!))
      .execute(),
  ]);
  if (workAreaId !== undefined && areas.length === 0) {
    throw new DomainError('not_found', 'Work area not found');
  }

  const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
  return areas
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((area) =>
      buildWorkAreaCountList({
        name: area.name,
        description: area.description,
        status: area.status,
        employees: employees.filter((e) => e.work_area_id === area.id).map((e) => e.name),
        lines: lines
          .filter((line) => line.work_area_id === area.id)
          .map((line) => ({
            id: line.id,
            at: Number(line.at),
            createdAt: line.created_at,
            description: line.description,
            ean: line.ean,
            input: line.input,
            serialNumber: line.serial_number,
            quantity: line.quantity,
            priceNet: line.price_net,
            priceGross: line.price_gross,
            isManual: line.is_manual,
            workstation: line.workstation,
          })),
        checkpoints: checkpoints
          .filter((checkpoint) => checkpoint.work_area_id === area.id)
          .map((checkpoint) => ({
            id: checkpoint.id,
            at: Number(checkpoint.at),
            createdAt: checkpoint.created_at,
            workstation: checkpoint.workstation,
          })),
      }),
    );
}

/** The count list PDF of a work area, or of all work areas without `workAreaId`. */
export async function createCountList(
  db: Db,
  stocktakeId: number,
  workAreaId?: number,
): Promise<{ filename: string; pdf: Buffer }> {
  const stocktake = await getStocktake(db, stocktakeId);
  const areas = await loadWorkAreaCountLists(db, stocktakeId, workAreaId);
  const pdf = await renderCountList(areas, {
    stocktakeName: stocktake.name,
    createdAt: new Date(),
    scope: workAreaId === undefined ? 'stocktake' : 'work_area',
  });
  const name = [stocktake.name, 'Zählliste', workAreaId === undefined ? null : areas[0]!.name]
    .filter(Boolean)
    .join(' - ');
  return { filename: `${safeFileName(name)}.pdf`, pdf };
}
