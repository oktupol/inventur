import {
  MAX_SEARCH_RESULTS,
  type ArticleMatch,
  type ArticleResolution,
  type ArticleSearchResponse,
  type MatchField,
} from '@inventur/shared';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import type { Trx } from '../stocktake/service.ts';
import {
  descriptionWords,
  escapeLike,
  normalizeQuery,
  resolve,
  toSearchResponse,
} from './rules.ts';

interface Hit {
  id: number;
  matchedBy: MatchField;
  matchedNumber: string | null;
}

/** Loads the articles of the hits with all their article numbers. */
async function loadMatches(db: Db | Trx, hits: readonly Hit[]): Promise<ArticleMatch[]> {
  if (hits.length === 0) return [];
  const rows = await db
    .selectFrom('master_data.article as a')
    .selectAll('a')
    .select(
      sql<string[]>`coalesce(
        (SELECT array_agg(n.number ORDER BY n.number)
           FROM master_data.article_number n WHERE n.article_id = a.id),
        '{}')`.as('article_numbers'),
    )
    .where(
      'a.id',
      'in',
      hits.map((hit) => hit.id),
    )
    .execute();
  const articles = new Map(rows.map((row) => [row.id, row]));
  return hits.flatMap((hit) => {
    const row = articles.get(hit.id);
    if (!row) return [];
    return [
      {
        id: row.id,
        description: row.description,
        ean: row.ean,
        articleNumbers: row.article_numbers,
        category: row.category,
        priceNet: row.price_net,
        priceGross: row.price_gross,
        matchedBy: hit.matchedBy,
        matchedNumber: hit.matchedNumber,
      },
    ];
  });
}

async function exactHits(db: Db | Trx, query: string, limit: number): Promise<Hit[]> {
  const [byEan, byNumber] = await Promise.all([
    db
      .selectFrom('master_data.article')
      .select('id')
      .where('ean', '=', query)
      .limit(limit)
      .execute(),
    db
      .selectFrom('master_data.article_number')
      .select(['article_id', 'number'])
      .where(sql`lower(number)`, '=', query.toLowerCase())
      .limit(limit)
      .execute(),
  ]);
  return [
    ...byEan.map(({ id }) => ({ id, matchedBy: 'ean' as const, matchedNumber: null })),
    ...byNumber.map(({ article_id, number }) => ({
      id: article_id,
      matchedBy: 'article_number' as const,
      matchedNumber: number,
    })),
  ];
}

async function partialHits(db: Db | Trx, query: string, limit: number): Promise<Hit[]> {
  const prefix = `${escapeLike(query.toLowerCase())}%`;
  const words = descriptionWords(query);
  const [byEan, byNumber, byDescription] = await Promise.all([
    db
      .selectFrom('master_data.article')
      .select('id')
      .where('ean', 'like', prefix)
      .orderBy('ean')
      .limit(limit)
      .execute(),
    db
      .selectFrom('master_data.article_number')
      .select(['article_id', 'number'])
      .where(sql`lower(number)`, 'like', prefix)
      .orderBy(sql`lower(number)`)
      .limit(limit)
      .execute(),
    db
      .selectFrom('master_data.article')
      .select('id')
      .where((eb) =>
        eb.and(words.map((word) => eb(sql`lower(description)`, 'like', `%${escapeLike(word)}%`))),
      )
      .orderBy('description')
      .orderBy('id')
      .limit(limit)
      .execute(),
  ]);
  return [
    ...byEan.map(({ id }) => ({ id, matchedBy: 'ean' as const, matchedNumber: null })),
    ...byNumber.map(({ article_id, number }) => ({
      id: article_id,
      matchedBy: 'article_number' as const,
      matchedNumber: number,
    })),
    ...byDescription.map(({ id }) => ({
      id,
      matchedBy: 'description' as const,
      matchedNumber: null,
    })),
  ];
}

/**
 * Searches the master data by EAN, article number and description. If the
 * query equals an EAN or article number, only those exact matches count.
 */
export async function searchArticles(
  db: Db | Trx,
  rawQuery: string,
  limit = MAX_SEARCH_RESULTS,
): Promise<ArticleSearchResponse> {
  const query = normalizeQuery(rawQuery);
  if (query === '') return { articles: [], exact: false, hasMore: false };
  // One more than the limit reveals whether further matches exist.
  const exact = await exactHits(db, query, limit + 1);
  const hits = exact.length > 0 ? exact : await partialHits(db, query, limit + 1);
  return toSearchResponse(await loadMatches(db, hits), exact.length > 0, limit);
}

/** Resolves a confirmed input (Enter or scan) into unique, ambiguous or not found. */
export async function resolveArticle(db: Db | Trx, query: string): Promise<ArticleResolution> {
  return resolve(await searchArticles(db, query));
}
