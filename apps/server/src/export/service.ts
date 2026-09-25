import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { DomainError } from '../errors.ts';
import { getReconciliation } from '../statistics/service.ts';
import { getStocktake } from '../stocktake/service.ts';
import { toCsv } from './csv.ts';
import {
  articleTable,
  entryTable,
  reconciliationTable,
  type ExportEntry,
  type Table,
} from './table.ts';
import { toXlsx } from './xlsx.ts';

export type ExportKind = 'entries' | 'articles' | 'reconciliation';
export type ExportFormat = 'csv' | 'xlsx';

export interface ExportRequest {
  stocktakeId: number;
  kind: ExportKind;
  format: ExportFormat;
  /** Restricts lines and articles to a work area; the comparison always covers the stocktake. */
  workAreaId?: number;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

const TITLES: Record<ExportKind, string> = {
  entries: 'Einzelzeilen',
  articles: 'Artikel',
  reconciliation: 'Soll-Ist-Abgleich',
};

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function loadEntries(
  db: Db,
  stocktakeId: number,
  workAreaId: number | undefined,
): Promise<ExportEntry[]> {
  const rows = await db
    .selectFrom('inventory.entry as e')
    .innerJoin('inventory.work_area as a', 'a.id', 'e.work_area_id')
    .innerJoin('inventory.workstation as w', 'w.id', 'e.workstation_id')
    .select([
      'e.id',
      'a.name as work_area',
      'e.article_id',
      'e.is_manual',
      'e.description',
      'e.ean',
      'e.category',
      'e.serial_number',
      'e.quantity',
      'e.price_net',
      'e.price_gross',
      'w.name as workstation',
      'e.created_at',
      sql<string[] | null>`(
        select array_agg(n.number order by n.number)
        from master_data.article_number n where n.article_id = e.article_id
      )`.as('article_numbers'),
      sql<string[] | null>`(
        select array_agg(m.name order by m.name)
        from inventory.entry_employee ee
        join inventory.employee m on m.id = ee.employee_id
        where ee.entry_id = e.id
      )`.as('employees'),
    ])
    .where('e.stocktake_id', '=', stocktakeId)
    .$if(workAreaId !== undefined, (query) => query.where('e.work_area_id', '=', workAreaId!))
    .execute();
  return rows.map((row) => ({
    id: row.id,
    workArea: row.work_area,
    articleId: row.article_id,
    isManual: row.is_manual,
    description: row.description,
    ean: row.ean,
    articleNumbers: row.is_manual ? [] : (row.article_numbers ?? []),
    category: row.category,
    serialNumber: row.serial_number,
    quantity: row.quantity,
    priceNet: row.price_net,
    priceGross: row.price_gross,
    workstation: row.workstation,
    employees: row.employees ?? [],
    createdAt: row.created_at,
  }));
}

async function loadArticleNumbers(db: Db): Promise<Map<number, string[]>> {
  const rows = await db
    .selectFrom('master_data.article_number')
    .select(['article_id', sql<string[]>`array_agg(number order by number)`.as('numbers')])
    .groupBy('article_id')
    .execute();
  return new Map(rows.map((row) => [row.article_id, row.numbers]));
}

/** Characters that are not allowed in file names on Windows. */
function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
}

export async function createExport(db: Db, request: ExportRequest): Promise<ExportFile> {
  const stocktake = await getStocktake(db, request.stocktakeId);
  let workAreaName: string | undefined;
  if (request.workAreaId !== undefined) {
    if (request.kind === 'reconciliation') {
      throw new DomainError('validation_failed', 'The comparison covers the whole stocktake');
    }
    const workArea = await db
      .selectFrom('inventory.work_area')
      .select('name')
      .where('id', '=', request.workAreaId)
      .where('stocktake_id', '=', request.stocktakeId)
      .executeTakeFirst();
    if (!workArea) throw new DomainError('not_found', 'Work area not found');
    workAreaName = workArea.name;
  }

  let table: Table;
  if (request.kind === 'reconciliation') {
    const [reconciliation, articleNumbers] = await Promise.all([
      getReconciliation(db, request.stocktakeId, null),
      loadArticleNumbers(db),
    ]);
    table = reconciliationTable(reconciliation, articleNumbers);
  } else {
    const entries = await loadEntries(db, request.stocktakeId, request.workAreaId);
    table = request.kind === 'entries' ? entryTable(entries) : articleTable(entries);
  }

  const title = TITLES[request.kind];
  const name = [stocktake.name, title, workAreaName].filter(Boolean).join(' - ');
  return {
    filename: `${safeFileName(name)}.${request.format}`,
    contentType: CONTENT_TYPES[request.format],
    body:
      request.format === 'csv' ? await toCsv(table) : await toXlsx(table, workAreaName ?? title),
  };
}

/** `Content-Disposition` with an ASCII fallback and the UTF-8 file name. */
export function contentDisposition(filename: string): string {
  const fallback = filename
    .normalize('NFD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/"/g, '');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
