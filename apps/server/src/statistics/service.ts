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
  const [workAreas, employees, entries, workstations] = await Promise.all([
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
  ]);
  return computeStatistics({
    stocktakeId,
    workAreas,
    employees,
    workstations,
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

export async function getReconciliation(db: Db, stocktakeId: number): Promise<Reconciliation> {
  await getStocktake(db, stocktakeId);
  const counted = db
    .selectFrom('inventory.entry')
    .select(['article_id', sql<string>`sum(quantity)`.as('counted')])
    .where('stocktake_id', '=', stocktakeId)
    .where('is_manual', '=', false)
    .where('article_id', 'is not', null)
    .groupBy('article_id');
  const missing = db
    .selectFrom('master_data.article as a')
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('inventory.entry as e')
            .select('e.id')
            .whereRef('e.article_id', '=', 'a.id')
            .where('e.stocktake_id', '=', stocktakeId)
            .where('e.is_manual', '=', false),
        ),
      ),
    );

  const [articleCount, shortageByCategory, shortageArticles, excess, unknown, manual] =
    await Promise.all([
      db
        .selectFrom('master_data.article')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
      missing
        .select([
          'a.category',
          sql<string>`count(*)`.as('count'),
          sql<string>`sum(a.price_net)`.as('net'),
          sql<string>`sum(a.price_gross)`.as('gross'),
        ])
        .groupBy('a.category')
        .execute(),
      // One more than the limit shows that the list is truncated.
      missing
        .select(['a.id', 'a.description', 'a.ean', 'a.category', 'a.price_net', 'a.price_gross'])
        .orderBy(sql`a.category nulls last`)
        .orderBy('a.description')
        .orderBy('a.id')
        .limit(SHORTAGE_LIST_LIMIT + 1)
        .execute(),
      db
        .selectFrom('master_data.article as a')
        .innerJoin(counted.as('c'), 'c.article_id', 'a.id')
        .select([
          'a.id',
          'a.description',
          'a.ean',
          'a.category',
          'a.price_net',
          'a.price_gross',
          'c.counted',
        ])
        .where(sql<boolean>`c.counted > 1`)
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
    ]);

  return reconcile({
    stocktakeId,
    articleCount: Number(articleCount.n),
    shortage: {
      byCategory: shortageByCategory.map((row) => ({
        category: row.category,
        count: Number(row.count),
        net: row.net,
        gross: row.gross,
      })),
      articles: shortageArticles.map((row) => ({
        articleId: row.id,
        description: row.description,
        ean: row.ean,
        category: row.category,
        priceNet: row.price_net,
        priceGross: row.price_gross,
      })),
    },
    counted: excess.map((row) => ({
      articleId: row.id,
      description: row.description,
      ean: row.ean,
      category: row.category,
      priceNet: row.price_net,
      priceGross: row.price_gross,
      counted: Number(row.counted),
    })),
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
