import {
  MAX_SEARCH_RESULTS,
  type ArticleMatch,
  type ArticleResolution,
  type ArticleSearchResponse,
  type MatchField,
} from '@inventur/shared';

/**
 * Search rules, independent of the database:
 * - case-insensitive
 * - EAN and article numbers match as a prefix
 * - in the description, every word must occur as a substring
 * - an exact EAN or article number wins over all other matches
 */

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** Lower-case words of the query, each of which must occur in the description. */
export function descriptionWords(query: string): string[] {
  const normalized = normalizeQuery(query).toLowerCase();
  return normalized === '' ? [] : [...new Set(normalized.split(' '))];
}

/**
 * The trigram index helps only with words of at least three characters. For
 * shorter words the description search scans the table.
 */
export function usesTrigramIndex(words: readonly string[]): boolean {
  return words.some((word) => word.length >= 3);
}

/** Escapes `%`, `_` and `\` for use in a LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const FIELD_RANK: Record<MatchField, number> = { ean: 0, article_number: 1, description: 2 };

/**
 * Orders matches: EAN before article number before description, then by
 * description; keeps one match per article (the best one).
 */
export function rankMatches(matches: readonly ArticleMatch[]): ArticleMatch[] {
  const best = new Map<number, ArticleMatch>();
  for (const match of matches) {
    const current = best.get(match.id);
    if (!current || FIELD_RANK[match.matchedBy] < FIELD_RANK[current.matchedBy]) {
      best.set(match.id, match);
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      FIELD_RANK[a.matchedBy] - FIELD_RANK[b.matchedBy] ||
      a.description.localeCompare(b.description, 'de') ||
      a.id - b.id,
  );
}

/** Cuts the ranked matches to the maximum and records whether more exist. */
export function toSearchResponse(
  matches: readonly ArticleMatch[],
  exact: boolean,
  limit = MAX_SEARCH_RESULTS,
): ArticleSearchResponse {
  const ranked = rankMatches(matches);
  return { articles: ranked.slice(0, limit), exact, hasMore: ranked.length > limit };
}

/**
 * Resolves a confirmed input: exactly one match is green (unique), several
 * are yellow (ambiguous, the user chooses), none is red (not found).
 */
export function resolve(search: ArticleSearchResponse): ArticleResolution {
  const count = search.articles.length;
  const result =
    count === 0 ? 'not_found' : count === 1 && !search.hasMore ? 'unique' : 'ambiguous';
  return { ...search, result };
}
