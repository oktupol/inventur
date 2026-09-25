import { hasValidEanCheckDigit, type MasterDataCheckKind } from '@inventur/shared';
import { toCents } from '../money.ts';

/**
 * Checks of the master data, independent of the database. They work on a
 * lean projection of all articles and return the affected article ids.
 */

export interface CheckedArticle {
  id: number;
  ean: string | null;
  priceNet: string;
  priceGross: string;
}

export interface CheckedNumber {
  articleId: number;
  number: string;
}

/** An affected article and the code the issue concerns. */
export interface Finding {
  articleId: number;
  code: string | null;
}

/** Items that share a key with others, grouped by key in the order of the keys. */
export function duplicatesBy<T>(items: readonly T[], key: (item: T) => string | null): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    const group = groups.get(value);
    if (group) group.push(item);
    else groups.set(value, [item]);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([, group]) => group);
}

/** Runs every check; the findings of a check are ordered for display. */
export function runChecks(
  articles: readonly CheckedArticle[],
  numbers: readonly CheckedNumber[],
): Record<MasterDataCheckKind, Finding[]> {
  const withNumber = new Set(numbers.map((n) => n.articleId));
  const byId = (a: { articleId: number }, b: { articleId: number }) => a.articleId - b.articleId;
  return {
    duplicate_ean: duplicatesBy(articles, (a) => a.ean).map((a) => ({
      articleId: a.id,
      code: a.ean,
    })),
    duplicate_article_number: duplicatesBy(numbers, (n) => n.number).map((n) => ({
      articleId: n.articleId,
      code: n.number,
    })),
    without_code: articles
      .filter((a) => a.ean === null && !withNumber.has(a.id))
      .map((a) => ({ articleId: a.id, code: null }))
      .sort(byId),
    invalid_ean: articles
      .filter((a) => a.ean !== null && /^(\d{8}|\d{13})$/.test(a.ean))
      .filter((a) => !hasValidEanCheckDigit(a.ean!))
      .map((a) => ({ articleId: a.id, code: a.ean }))
      .sort(byId),
    zero_price: articles
      .filter((a) => toCents(a.priceNet) === 0n || toCents(a.priceGross) === 0n)
      .map((a) => ({ articleId: a.id, code: null }))
      .sort(byId),
    gross_below_net: articles
      .filter((a) => toCents(a.priceGross) < toCents(a.priceNet))
      .map((a) => ({ articleId: a.id, code: null }))
      .sort(byId),
  };
}
