import {
  SHORTAGE_LIST_LIMIT,
  type Reconciliation,
  type StocktakeStatistics,
} from '@inventur/shared';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { getStocktake } from '../stocktake/service.ts';
import { computeStatistics } from './compute.ts';
import { reconcile } from './reconciliation.ts';

export async function getStatistics(db: Db, stocktakeId: number): Promise<StocktakeStatistics> {
  const stocktake = await getStocktake(db, stocktakeId);
  const [workAreas, employees, entries, workstations, expected] = await Promise.all([
    db
      .selectFrom('inventory.work_area')
      .select(['id', 'name', 'status'])
      .where('stocktake_id', '=', stocktakeId)
      .execute(),
    db
      .selectFrom('inventory.employee')
      .select(['id', 'name'])
      .where('stocktake_id', '=', stocktakeId)
      .execute(),
    db
      .selectFrom('inventory.entry as e')
      .select((eb) => [
        'e.id',
        'e.work_area_id',
        'e.article_id',
        'e.is_manual',
        'e.input',
        'e.description',
        'e.ean',
        'e.category',
        'e.price_net',
        'e.price_gross',
        'e.serial_number',
        'e.quantity',
        'e.workstation_id',
        'e.created_at',
        eb
          .selectFrom('inventory.entry_employee as ee')
          .select(sql<number[]>`coalesce(array_agg(ee.employee_id), '{}')`.as('ids'))
          .whereRef('ee.entry_id', '=', 'e.id')
          .as('employee_ids'),
      ])
      .where('e.stocktake_id', '=', stocktakeId)
      .execute(),
    db
      .selectFrom('inventory.workstation')
      .select(['id', 'name'])
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('inventory.entry')
          .select('workstation_id')
          .where('stocktake_id', '=', stocktakeId),
      )
      .execute(),
    db
      .selectFrom('master_data.article as a')
      .select(['a.id', 'a.expected_quantity'])
      .where('a.expected_quantity', 'is not', null)
      .where('a.id', 'in', (eb) =>
        eb
          .selectFrom('inventory.entry')
          .select('article_id')
          .where('stocktake_id', '=', stocktakeId)
          .where('article_id', 'is not', null),
      )
      .execute(),
  ]);
  return computeStatistics({
    stocktakeId,
    workAreas,
    employees,
    workstations,
    expectedQuantities: new Map(expected.map((row) => [row.id, row.expected_quantity!])),
    entries: entries.map((row) => ({
      id: row.id,
      workAreaId: row.work_area_id,
      articleId: row.article_id,
      isManual: row.is_manual,
      input: row.input,
      description: row.description,
      ean: row.ean,
      category: row.category,
      priceNet: row.price_net,
      priceGross: row.price_gross,
      serialNumber: row.serial_number,
      quantity: row.quantity,
      workstationId: row.workstation_id,
      createdAt: row.created_at,
      employeeIds: (row.employee_ids ?? []).map(Number),
    })),
    until: stocktake.finishedAt ? new Date(stocktake.finishedAt) : new Date(),
  });
}

/** With `listLimit` null, the shortage list is complete, e.g. for the export. */
export async function getReconciliation(
  db: Db,
  stocktakeId: number,
  listLimit: number | null = SHORTAGE_LIST_LIMIT,
): Promise<Reconciliation> {
  await getStocktake(db, stocktakeId);
  const counted = db
    .selectFrom('inventory.entry')
    .select(['article_id', sql<string>`sum(quantity)`.as('counted')])
    .where('stocktake_id', '=', stocktakeId)
    .where('is_manual', '=', false)
    .where('article_id', 'is not', null)
    .groupBy('article_id');
  // Articles with a target quantity and their counted quantity (0 if never captured).
  const compared = db
    .selectFrom('master_data.article as a')
    .leftJoin(counted.as('c'), 'c.article_id', 'a.id')
    .where('a.expected_quantity', 'is not', null);
  const countedSql = sql<number>`coalesce(c.counted, 0)`;
  const missingSql = sql<number>`(a.expected_quantity - coalesce(c.counted, 0))`;
  const missing = compared.where(sql<boolean>`${countedSql} < a.expected_quantity`);
  const articleColumns = [
    'a.id',
    'a.description',
    'a.ean',
    'a.category',
    'a.price_net',
    'a.price_gross',
    'a.expected_quantity',
    countedSql.as('counted'),
  ] as const;

  const [totals, shortageByCategory, shortageArticles, excess, unknown, manual] = await Promise.all(
    [
      db
        .selectFrom('master_data.article')
        .select([
          sql<string>`count(expected_quantity)`.as('with_target'),
          sql<string>`count(*) - count(expected_quantity)`.as('without_target'),
          sql<string>`coalesce(sum(expected_quantity), 0)`.as('expected'),
        ])
        .executeTakeFirstOrThrow(),
      missing
        .select([
          'a.category',
          sql<string>`count(*)`.as('count'),
          sql<string>`sum(${missingSql})`.as('quantity'),
          sql<string>`sum(a.price_net * ${missingSql})`.as('net'),
          sql<string>`sum(a.price_gross * ${missingSql})`.as('gross'),
        ])
        .groupBy('a.category')
        .execute(),
      // One more than the limit shows that the list is truncated.
      missing
        .select(articleColumns)
        .orderBy(sql`a.category nulls last`)
        .orderBy('a.description')
        .orderBy('a.id')
        .$if(listLimit !== null, (query) => query.limit(listLimit! + 1))
        .execute(),
      compared
        .select(articleColumns)
        .where(sql<boolean>`${countedSql} > a.expected_quantity`)
        .execute(),
      // Uses the snapshot of the newest line of each article.
      db
        .selectFrom('inventory.entry as e')
        .distinctOn('e.article_id')
        .select([
          'e.article_id',
          'e.description',
          'e.ean',
          'e.category',
          'e.price_net',
          'e.price_gross',
          sql<string>`sum(e.quantity) over (partition by e.article_id)`.as('counted'),
        ])
        .where('e.stocktake_id', '=', stocktakeId)
        .where('e.is_manual', '=', false)
        .where('e.article_id', 'is not', null)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('master_data.article as a')
                .select('a.id')
                .whereRef('a.id', '=', 'e.article_id'),
            ),
          ),
        )
        .orderBy('e.article_id')
        .orderBy('e.id', 'desc')
        .execute(),
      db
        .selectFrom('inventory.entry')
        .select(['id', 'description', 'price_gross', 'quantity'])
        .where('stocktake_id', '=', stocktakeId)
        .where('is_manual', '=', true)
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
    ],
  );

  const articleCount = (row: (typeof excess)[number]) => ({
    articleId: row.id,
    description: row.description,
    ean: row.ean,
    category: row.category,
    priceNet: row.price_net,
    priceGross: row.price_gross,
    expected: row.expected_quantity!,
    counted: Number(row.counted),
  });
  return reconcile({
    stocktakeId,
    listLimit: listLimit ?? Infinity,
    articleCount: Number(totals.with_target),
    expectedQuantity: Number(totals.expected),
    withoutTargetCount: Number(totals.without_target),
    shortage: {
      byCategory: shortageByCategory.map((row) => ({
        category: row.category,
        count: Number(row.count),
        quantity: Number(row.quantity),
        net: row.net,
        gross: row.gross,
      })),
      articles: shortageArticles.map(articleCount),
    },
    excess: excess.map(articleCount),
    unknown: unknown.map((row) => ({
      articleId: row.article_id!,
      description: row.description,
      ean: row.ean,
      category: row.category,
      priceNet: row.price_net,
      priceGross: row.price_gross,
      counted: Number(row.counted),
    })),
    manual: manual.map((row) => ({
      entryId: row.id,
      description: row.description,
      priceGross: row.price_gross,
      quantity: row.quantity,
    })),
  });
}
