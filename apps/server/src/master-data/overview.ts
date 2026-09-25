import type {
  MasterDataArticle,
  MasterDataArticlePage,
  MasterDataCheckKind,
  MasterDataOverview,
} from '@inventur/shared';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { searchArticles } from '../search/service.ts';
import { runChecks } from './checks.ts';

/** Affected articles listed per check; the count covers all of them. */
export const MAX_ISSUES = 500;

/** Articles per page of the article list. */
export const ARTICLE_PAGE_SIZE = 100;

/** Articles a search lists at most. */
const MAX_SEARCH_ARTICLES = 500;

const CHECK_ORDER: MasterDataCheckKind[] = [
  'duplicate_ean',
  'duplicate_article_number',
  'without_code',
  'invalid_ean',
  'zero_price',
  'gross_below_net',
];

function articleQuery(db: Db) {
  return db.selectFrom('master_data.article as a').select([
    'a.id',
    'a.description',
    'a.ean',
    'a.category',
    'a.price_net',
    'a.price_gross',
    'a.expected_quantity',
    sql<string[] | null>`(
        SELECT array_agg(n.number ORDER BY n.number)
        FROM master_data.article_number n WHERE n.article_id = a.id
      )`.as('numbers'),
  ]);
}

type ArticleRow = Awaited<ReturnType<ReturnType<typeof articleQuery>['execute']>>[number];

function toArticle(row: ArticleRow): MasterDataArticle {
  return {
    id: row.id,
    description: row.description,
    ean: row.ean,
    articleNumbers: row.numbers ?? [],
    category: row.category,
    priceNet: row.price_net,
    priceGross: row.price_gross,
    expectedQuantity: row.expected_quantity,
  };
}

async function loadArticles(
  db: Db,
  ids: readonly number[],
): Promise<Map<number, MasterDataArticle>> {
  if (ids.length === 0) return new Map();
  const rows = await articleQuery(db)
    .where('a.id', 'in', [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, toArticle(row)]));
}

/** Target quantity and its value over a set of articles, as SQL aggregates. */
const expectedStock = [
  sql<string>`count(expected_quantity)`.as('expected_articles'),
  sql<string>`coalesce(sum(expected_quantity), 0)`.as('expected_quantity'),
  sql<string>`coalesce(sum(expected_quantity * price_net), 0)::numeric(16,2)`.as('net'),
  sql<string>`coalesce(sum(expected_quantity * price_gross), 0)::numeric(16,2)`.as('gross'),
] as const;

/**
 * Key figures of the master data and the results of the checks. Computed on
 * request, since the application learns nothing of changes to the master data.
 */
export async function getMasterDataOverview(db: Db): Promise<MasterDataOverview> {
  const [totals, categories, lean, numbers] = await Promise.all([
    db
      .selectFrom('master_data.article as a')
      .select([
        sql<string>`count(*)`.as('articles'),
        sql<string>`count(ean)`.as('with_ean'),
        sql<string>`count(*) FILTER (WHERE expected_quantity IS NULL)`.as('without_expected'),
        sql<string>`count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM master_data.article_number n WHERE n.article_id = a.id))`.as('with_number'),
        ...expectedStock,
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('master_data.article')
      .select(['category', sql<string>`count(*)`.as('articles'), ...expectedStock])
      .groupBy('category')
      .orderBy(sql`category IS NULL`)
      .orderBy('category')
      .execute(),
    db
      .selectFrom('master_data.article')
      .select(['id', 'ean', 'price_net', 'price_gross'])
      .execute(),
    db.selectFrom('master_data.article_number').select(['article_id', 'number']).execute(),
  ]);

  const findings = runChecks(
    lean.map((a) => ({ id: a.id, ean: a.ean, priceNet: a.price_net, priceGross: a.price_gross })),
    numbers.map((n) => ({ articleId: n.article_id, number: n.number })),
  );
  const shown = CHECK_ORDER.flatMap((kind) =>
    findings[kind].slice(0, MAX_ISSUES).map((f) => f.articleId),
  );
  const articles = await loadArticles(db, [...new Set(shown)]);

  return {
    articleCount: Number(totals.articles),
    withEan: Number(totals.with_ean),
    withArticleNumber: Number(totals.with_number),
    withoutExpectedQuantity: Number(totals.without_expected),
    expected: {
      articles: Number(totals.expected_articles),
      quantity: Number(totals.expected_quantity),
      net: totals.net,
      gross: totals.gross,
    },
    byCategory: categories.map((row) => ({
      category: row.category,
      articleCount: Number(row.articles),
      articles: Number(row.expected_articles),
      quantity: Number(row.expected_quantity),
      net: row.net,
      gross: row.gross,
    })),
    checks: CHECK_ORDER.map((kind) => {
      const all = findings[kind];
      return {
        kind,
        count: new Set(all.map((f) => f.articleId)).size,
        issues: all.slice(0, MAX_ISSUES).map((f) => ({
          article: articles.get(f.articleId)!,
          code: f.code,
        })),
        truncated: all.length > MAX_ISSUES,
      };
    }),
  };
}

/**
 * One page of the articles, by description; with a search, the matches as
 * at the workstation (at most 500).
 */
export async function listMasterDataArticles(
  db: Db,
  query: string,
  offset: number,
): Promise<MasterDataArticlePage> {
  if (query.trim() === '') {
    const [page, count] = await Promise.all([
      articleQuery(db)
        .orderBy('a.description')
        .orderBy('a.id')
        .offset(offset)
        .limit(ARTICLE_PAGE_SIZE)
        .execute(),
      db
        .selectFrom('master_data.article')
        .select(sql<string>`count(*)`.as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    return { articles: page.map(toArticle), offset, total: Number(count.n), hasMore: false };
  }
  const search = await searchArticles(db, query, MAX_SEARCH_ARTICLES);
  const ids = search.articles.map((a) => a.id);
  const pageIds = ids.slice(offset, offset + ARTICLE_PAGE_SIZE);
  const articles = await loadArticles(db, pageIds);
  return {
    articles: pageIds.map((id) => articles.get(id)!),
    offset,
    total: ids.length,
    hasMore: search.hasMore,
  };
}
