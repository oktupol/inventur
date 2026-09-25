import {
  SHORTAGE_LIST_LIMIT,
  type Reconciliation,
  type ShortageArticle,
  type ShortageCategory,
  type SurplusItem,
} from '@inventur/shared';
import { fromCents, lineCents, toCents } from '../money.ts';

/**
 * Target/actual comparison, independent of the database. Each article of the
 * master data may have a target quantity; articles without one are left out.
 * An article counted less often than its target is part of the shortage, one
 * counted more often part of the surplus, by the difference in pieces.
 */

export interface ArticleCount {
  articleId: number;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string;
  priceGross: string;
  /** Target quantity. */
  expected: number;
  /** Sum of the quantities of all lines of the article in the stocktake. */
  counted: number;
}

export interface CapturedArticle {
  articleId: number;
  /** Snapshot of the master data from a line of the article. */
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string | null;
  priceGross: string;
  counted: number;
}

export interface ManualLine {
  entryId: number;
  description: string;
  priceGross: string;
  quantity: number;
}

export interface ReconciliationInput {
  stocktakeId: number;
  /** Articles of the master data with a target quantity. */
  articleCount: number;
  /** Sum of their target quantities. */
  expectedQuantity: number;
  withoutTargetCount: number;
  /**
   * Articles of the master data counted less often than their target. The
   * database aggregates them, because at the start of a stocktake these are
   * all articles.
   */
  shortage: {
    /** Articles, missing pieces and their values per category. */
    byCategory: readonly ShortageCategory[];
    /** The first articles by category and description; more than `listLimit` means truncated. */
    articles: readonly ArticleCount[];
  };
  /** Articles of the master data counted more often than their target. */
  excess: readonly ArticleCount[];
  /** Captured articles that are no longer in the master data. */
  unknown: readonly CapturedArticle[];
  manual: readonly ManualLine[];
  listLimit?: number;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Orders by category, without category last. */
function compareCategories(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return collator.compare(a, b);
}

function shortageArticle(article: ArticleCount): ShortageArticle {
  const missing = article.expected - article.counted;
  return {
    articleId: article.articleId,
    description: article.description,
    ean: article.ean,
    category: article.category,
    priceNet: article.priceNet,
    priceGross: article.priceGross,
    expected: article.expected,
    counted: article.counted,
    missing,
    net: fromCents(lineCents(article.priceNet, missing)),
    gross: fromCents(lineCents(article.priceGross, missing)),
  };
}

function excessItem(article: ArticleCount): SurplusItem {
  const surplus = article.counted - article.expected;
  return {
    kind: 'excess',
    articleId: article.articleId,
    entryId: null,
    description: article.description,
    ean: article.ean,
    category: article.category,
    priceNet: article.priceNet,
    priceGross: article.priceGross,
    expected: article.expected,
    counted: article.counted,
    surplus,
    net: fromCents(lineCents(article.priceNet, surplus)),
    gross: fromCents(lineCents(article.priceGross, surplus)),
  };
}

function unknownItem(article: CapturedArticle): SurplusItem {
  return {
    kind: 'unknown',
    articleId: article.articleId,
    entryId: null,
    description: article.description,
    ean: article.ean,
    category: article.category,
    priceNet: article.priceNet,
    priceGross: article.priceGross,
    expected: 0,
    counted: article.counted,
    surplus: article.counted,
    net: article.priceNet === null ? null : fromCents(lineCents(article.priceNet, article.counted)),
    gross: fromCents(lineCents(article.priceGross, article.counted)),
  };
}

function manualItem(line: ManualLine): SurplusItem {
  return {
    kind: 'manual',
    articleId: null,
    entryId: line.entryId,
    description: line.description,
    ean: null,
    category: null,
    priceNet: null,
    priceGross: line.priceGross,
    expected: 0,
    counted: line.quantity,
    surplus: line.quantity,
    net: null,
    gross: fromCents(lineCents(line.priceGross, line.quantity)),
  };
}

export function reconcile(input: ReconciliationInput): Reconciliation {
  const limit = input.listLimit ?? SHORTAGE_LIST_LIMIT;
  const byCategory = [...input.shortage.byCategory].sort((a, b) =>
    compareCategories(a.category, b.category),
  );
  const sum = (pick: (category: ShortageCategory) => bigint) =>
    byCategory.reduce((total, category) => total + pick(category), 0n);
  const shortageArticles = input.shortage.articles
    .filter((article) => article.counted < article.expected)
    .map(shortageArticle);

  const counted = [
    ...input.excess.filter((article) => article.counted > article.expected).map(excessItem),
    ...input.unknown.map(unknownItem),
  ].sort(
    (a, b) =>
      collator.compare(a.description, b.description) || (a.articleId ?? 0) - (b.articleId ?? 0),
  );
  const items = [...counted, ...input.manual.map(manualItem)];

  return {
    stocktakeId: input.stocktakeId,
    articleCount: input.articleCount,
    expectedQuantity: input.expectedQuantity,
    withoutTargetCount: input.withoutTargetCount,
    shortage: {
      count: byCategory.reduce((total, category) => total + category.count, 0),
      quantity: byCategory.reduce((total, category) => total + category.quantity, 0),
      net: fromCents(sum((category) => toCents(category.net))),
      gross: fromCents(sum((category) => toCents(category.gross))),
      byCategory,
      articles: shortageArticles.slice(0, limit),
      truncated: shortageArticles.length > limit,
    },
    surplus: {
      quantity: items.reduce((total, item) => total + item.surplus, 0),
      net: fromCents(
        items.reduce((total, item) => total + (item.net ? toCents(item.net) : 0n), 0n),
      ),
      gross: fromCents(items.reduce((total, item) => total + toCents(item.gross), 0n)),
      items,
    },
  };
}
