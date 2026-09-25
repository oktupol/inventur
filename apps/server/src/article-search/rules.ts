import type { MatchField, StocktakeMatchField } from '@inventur/shared';
import { descriptionWords, normalizeQuery } from '../search/rules.ts';

/**
 * Rules of the article search in a stocktake, independent of the database.
 * Besides the master data it searches the lines of the stocktake: serial
 * numbers and inputs as a prefix, their snapshot like the master data.
 */

/** The fields of a line the search looks at. */
export interface SearchableEntry {
  serialNumber: string | null;
  ean: string | null;
  description: string;
  input: string;
}

/** Searches start from this many characters on. */
export const MIN_QUERY_LENGTH = 2;

/** Articles and manual lines returned by one search. */
export const MAX_RESULTS = 20;

const FIELD_RANK: Record<StocktakeMatchField, number> = {
  ean: 0,
  article_number: 1,
  serial_number: 2,
  input: 3,
  description: 4,
};

/** How a line matches the query, the best field first; null if it does not. */
export function entryMatch(entry: SearchableEntry, rawQuery: string): StocktakeMatchField | null {
  const query = normalizeQuery(rawQuery).toLowerCase();
  if (query.length < MIN_QUERY_LENGTH) return null;
  if (entry.ean?.toLowerCase().startsWith(query)) return 'ean';
  if (entry.serialNumber?.toLowerCase().startsWith(query)) return 'serial_number';
  if (entry.input.toLowerCase().startsWith(query)) return 'input';
  const description = entry.description.toLowerCase();
  const words = descriptionWords(query);
  if (words.length > 0 && words.every((word) => description.includes(word))) return 'description';
  return null;
}

export interface ArticleHit {
  articleId: number;
  matchedBy: StocktakeMatchField | MatchField;
}

/**
 * Combines matches in the master data and in lines into one list of
 * articles: the best match per article, ordered by field, master data
 * matches keeping their order within a field.
 */
export function mergeArticleHits(
  master: readonly ArticleHit[],
  fromEntries: readonly ArticleHit[],
  limit = MAX_RESULTS,
): { hits: ArticleHit[]; hasMore: boolean } {
  const best = new Map<number, { hit: ArticleHit; order: number }>();
  [...master, ...fromEntries].forEach((hit, order) => {
    const current = best.get(hit.articleId);
    if (!current || FIELD_RANK[hit.matchedBy] < FIELD_RANK[current.hit.matchedBy]) {
      best.set(hit.articleId, { hit, order: current?.order ?? order });
    }
  });
  const sorted = [...best.values()]
    .sort((a, b) => FIELD_RANK[a.hit.matchedBy] - FIELD_RANK[b.hit.matchedBy] || a.order - b.order)
    .map((entry) => entry.hit);
  return { hits: sorted.slice(0, limit), hasMore: sorted.length > limit };
}
