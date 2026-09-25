import type {
  FoundArticle,
  FoundEntry,
  StocktakeArticleDetail,
  StocktakeArticleSearchResponse,
  StocktakeMatchField,
} from '@inventur/shared';
import { sql } from 'kysely';
import { toAuditLogEntry } from '../audit/rules.ts';
import { auditLogQuery } from '../audit/service.ts';
import type { Db } from '../db/connection.ts';
import { DomainError } from '../errors.ts';
import { descriptionWords, escapeLike, normalizeQuery } from '../search/rules.ts';
import { searchArticles } from '../search/service.ts';
import { getStocktake } from '../stocktake/service.ts';
import {
  entryMatch,
  MAX_RESULTS,
  mergeArticleHits,
  MIN_QUERY_LENGTH,
  type ArticleHit,
} from './rules.ts';

/** Lines examined per search; enough for every line of a few articles. */
const MAX_CANDIDATE_LINES = 1000;

function foundEntryQuery(db: Db, stocktakeId: number) {
  return db
    .selectFrom('inventory.entry as e')
    .innerJoin('inventory.work_area as a', 'a.id', 'e.work_area_id')
    .innerJoin('inventory.workstation as w', 'w.id', 'e.workstation_id')
    .select([
      'e.id',
      'e.article_id',
      'e.is_manual',
      'e.description',
      'e.ean',
      'e.input',
      'e.serial_number',
      'e.quantity',
      'e.price_gross',
      'e.created_at',
      'a.id as work_area_id',
      'a.name as work_area_name',
      'w.id as workstation_id',
      'w.name as workstation_name',
      sql<string[] | null>`(
        SELECT array_agg(m.name ORDER BY m.name)
        FROM inventory.entry_employee ee
        JOIN inventory.employee m ON m.id = ee.employee_id
        WHERE ee.entry_id = e.id
      )`.as('employees'),
    ])
    .where('e.stocktake_id', '=', stocktakeId);
}

type FoundEntryRow = Awaited<ReturnType<ReturnType<typeof foundEntryQuery>['execute']>>[number];

function toFoundEntry(row: FoundEntryRow): FoundEntry {
  return {
    id: row.id,
    articleId: row.article_id,
    isManual: row.is_manual,
    description: row.description,
    code: row.ean ?? (row.input || null),
    serialNumber: row.serial_number,
    quantity: row.quantity,
    priceGross: row.price_gross,
    workArea: { id: row.work_area_id, name: row.work_area_name },
    workstation: { id: row.workstation_id, name: row.workstation_name },
    employees: row.employees ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * The articles with their current master data and what was captured of
 * them. Articles no longer in the master data show the snapshot of their
 * newest line.
 */
async function loadArticles(
  db: Db,
  stocktakeId: number,
  ids: readonly number[],
): Promise<Map<number, FoundArticle>> {
  if (ids.length === 0) return new Map();
  const [master, counts, snapshots] = await Promise.all([
    db
      .selectFrom('master_data.article as a')
      .select([
        'a.id',
        'a.description',
        'a.ean',
        'a.category',
        'a.price_gross',
        'a.expected_quantity',
        sql<string[] | null>`(
          SELECT array_agg(n.number ORDER BY n.number)
          FROM master_data.article_number n WHERE n.article_id = a.id
        )`.as('numbers'),
      ])
      .where('a.id', 'in', [...ids])
      .execute(),
    db
      .selectFrom('inventory.entry')
      .select([
        'article_id',
        sql<string>`sum(quantity)`.as('quantity'),
        sql<string>`count(*)`.as('lines'),
      ])
      .where('stocktake_id', '=', stocktakeId)
      .where('article_id', 'in', [...ids])
      .groupBy('article_id')
      .execute(),
    db
      .selectFrom('inventory.entry')
      .distinctOn('article_id')
      .select(['article_id', 'description', 'ean', 'category', 'price_gross'])
      .where('stocktake_id', '=', stocktakeId)
      .where('article_id', 'in', [...ids])
      .orderBy('article_id')
      .orderBy('created_at', 'desc')
      .execute(),
  ]);
  const masterById = new Map(master.map((row) => [row.id, row]));
  const countById = new Map(counts.map((row) => [row.article_id!, row]));
  const snapshotById = new Map(snapshots.map((row) => [row.article_id!, row]));
  const articles = new Map<number, FoundArticle>();
  for (const id of ids) {
    const current = masterById.get(id);
    const snapshot = snapshotById.get(id);
    const count = countById.get(id);
    const source = current ?? snapshot;
    if (!source) continue;
    articles.set(id, {
      articleId: id,
      description: source.description,
      ean: source.ean,
      articleNumbers: current?.numbers ?? [],
      category: source.category,
      priceGross: source.price_gross,
      inMasterData: current !== undefined,
      expectedQuantity: current?.expected_quantity ?? null,
      countedQuantity: Number(count?.quantity ?? 0),
      lines: Number(count?.lines ?? 0),
    });
  }
  return articles;
}

/**
 * Searches a stocktake for articles and manual lines: the master data like
 * at the workstation, and the lines of the stocktake by serial number,
 * input, EAN and description (also of articles no longer in the master data).
 */
export async function searchStocktakeArticles(
  db: Db,
  stocktakeId: number,
  rawQuery: string,
): Promise<StocktakeArticleSearchResponse> {
  await getStocktake(db, stocktakeId);
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return { articles: [], manualEntries: [], hasMore: false };

  const prefix = `${escapeLike(query.toLowerCase())}%`;
  const words = descriptionWords(query);
  const [master, candidates] = await Promise.all([
    searchArticles(db, query, MAX_RESULTS),
    db
      .selectFrom('inventory.entry')
      .select(['id', 'article_id', 'is_manual', 'serial_number', 'ean', 'description', 'input'])
      .where('stocktake_id', '=', stocktakeId)
      .where((eb) =>
        eb.or([
          eb(sql`lower(serial_number)`, 'like', prefix),
          eb(sql`lower(ean)`, 'like', prefix),
          eb(sql`lower(input)`, 'like', prefix),
          eb.and(words.map((word) => eb(sql`lower(description)`, 'like', `%${escapeLike(word)}%`))),
        ]),
      )
      .orderBy('created_at', 'desc')
      .limit(MAX_CANDIDATE_LINES)
      .execute(),
  ]);

  const fromEntries: ArticleHit[] = [];
  const manual: { id: number; matchedBy: StocktakeMatchField }[] = [];
  for (const row of candidates) {
    const matchedBy = entryMatch(
      {
        serialNumber: row.serial_number,
        ean: row.ean,
        description: row.description,
        input: row.input,
      },
      query,
    );
    if (matchedBy === null) continue;
    if (row.is_manual || row.article_id === null) manual.push({ id: row.id, matchedBy });
    else fromEntries.push({ articleId: row.article_id, matchedBy });
  }

  const { hits, hasMore } = mergeArticleHits(
    master.articles.map((a) => ({ articleId: a.id, matchedBy: a.matchedBy })),
    fromEntries,
  );
  const articles = await loadArticles(
    db,
    stocktakeId,
    hits.map((hit) => hit.articleId),
  );
  const manualPage = manual.slice(0, MAX_RESULTS);
  const manualRows =
    manualPage.length === 0
      ? []
      : await foundEntryQuery(db, stocktakeId)
          .where(
            'e.id',
            'in',
            manualPage.map((m) => m.id),
          )
          .orderBy('e.created_at', 'desc')
          .execute();
  const manualMatch = new Map(manualPage.map((m) => [m.id, m.matchedBy]));
  return {
    articles: hits.flatMap((hit) => {
      const article = articles.get(hit.articleId);
      return article ? [{ ...article, matchedBy: hit.matchedBy }] : [];
    }),
    manualEntries: manualRows.map((row) => ({
      ...toFoundEntry(row),
      matchedBy: manualMatch.get(row.id)!,
    })),
    hasMore: hasMore || master.hasMore || manual.length > MAX_RESULTS,
  };
}

/**
 * An article with all of its lines in the stocktake and the audit log of
 * these lines, including lines deleted since.
 */
export async function getStocktakeArticle(
  db: Db,
  stocktakeId: number,
  articleId: number,
): Promise<StocktakeArticleDetail> {
  await getStocktake(db, stocktakeId);
  const [articles, entries, auditRows] = await Promise.all([
    loadArticles(db, stocktakeId, [articleId]),
    foundEntryQuery(db, stocktakeId)
      .where('e.article_id', '=', articleId)
      .orderBy('e.created_at')
      .orderBy('e.id')
      .execute(),
    auditLogQuery(db, stocktakeId, {})
      .where(
        sql<boolean>`entry_id IN (
          SELECT id FROM inventory.entry
          WHERE stocktake_id = ${stocktakeId} AND article_id = ${articleId}
          UNION
          SELECT entry_id FROM inventory.audit_log
          WHERE stocktake_id = ${stocktakeId} AND action = 'deleted'
            AND (entry_snapshot -> 'entry' ->> 'article_id')::bigint = ${articleId}
        )`,
      )
      .execute(),
  ]);
  let article = articles.get(articleId);
  if (!article) {
    // Only deleted lines remain of an article that left the master data.
    const deleted = auditRows.find((row) => row.action === 'deleted');
    if (!deleted) throw new DomainError('not_found', 'Article not found in this stocktake');
    article = {
      articleId,
      description: deleted.description ?? '',
      ean: deleted.code,
      articleNumbers: [],
      category: null,
      priceGross: null,
      inMasterData: false,
      expectedQuantity: null,
      countedQuantity: 0,
      lines: 0,
    };
  }
  return {
    article,
    entries: entries.map(toFoundEntry),
    auditLog: auditRows.map(toAuditLogEntry),
  };
}
