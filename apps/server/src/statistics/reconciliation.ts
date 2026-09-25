import {
  SHORTAGE_LIST_LIMIT,
  type Reconciliation,
  type ShortageArticle,
  type ShortageCategory,
  type SurplusItem,
} from '@inventur/shared';
import { fromCents, lineCents, toCents } from '../money.ts';

/**
 * Target/actual comparison, independent of the database. Every article of
 * the master data is a single item with a target quantity of 1.
 */

export interface ArticleCount {
  articleId: number;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string;
  priceGross: string;
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
  /** Number of articles in the master data. */
  articleCount: number;
  /**
   * Articles of the master data that were not captured. The database
   * aggregates them, because at the start of a stocktake these are all
   * articles.
   */
  shortage: {
    /** Number and values of the articles per category. */
    byCategory: readonly ShortageCategory[];
    /** The first articles by category and description; more than `listLimit` means truncated. */
    articles: readonly ShortageArticle[];
  };
  /**
   * Articles of the master data with their counted quantity. Only those
   * counted more than once make a difference; the others match the target
   * or are part of the shortage.
   */
  counted: readonly ArticleCount[];
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

export function reconcile(input: ReconciliationInput): Reconciliation {
  const limit = input.listLimit ?? SHORTAGE_LIST_LIMIT;
  const byCategory = [...input.shortage.byCategory].sort((a, b) =>
    compareCategories(a.category, b.category),
  );
  const shortageNet = byCategory.reduce((sum, category) => sum + toCents(category.net), 0n);
  const shortageGross = byCategory.reduce((sum, category) => sum + toCents(category.gross), 0n);

  const counted: SurplusItem[] = [
    ...input.counted
      .filter((article) => article.counted > 1)
      .map((article): SurplusItem => {
        const surplus = article.counted - 1;
        return {
          kind: 'excess',
          articleId: article.articleId,
          entryId: null,
          description: article.description,
          ean: article.ean,
          category: article.category,
          priceNet: article.priceNet,
          priceGross: article.priceGross,
          expected: 1,
          counted: article.counted,
          surplus,
          net: fromCents(lineCents(article.priceNet, surplus)),
          gross: fromCents(lineCents(article.priceGross, surplus)),
        };
      }),
    ...input.unknown.map((article): SurplusItem => ({
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
      net:
        article.priceNet === null ? null : fromCents(lineCents(article.priceNet, article.counted)),
      gross: fromCents(lineCents(article.priceGross, article.counted)),
    })),
  ].sort(
    (a, b) =>
      collator.compare(a.description, b.description) || (a.articleId ?? 0) - (b.articleId ?? 0),
  );
  const manual = input.manual.map((line): SurplusItem => ({
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
  }));
  const items = [...counted, ...manual];

  return {
    stocktakeId: input.stocktakeId,
    articleCount: input.articleCount,
    shortage: {
      count: byCategory.reduce((sum, category) => sum + category.count, 0),
      net: fromCents(shortageNet),
      gross: fromCents(shortageGross),
      byCategory,
      articles: input.shortage.articles.slice(0, limit),
      truncated: input.shortage.articles.length > limit,
    },
    surplus: {
      quantity: items.reduce((sum, item) => sum + item.surplus, 0),
      net: fromCents(items.reduce((sum, item) => sum + (item.net ? toCents(item.net) : 0n), 0n)),
      gross: fromCents(items.reduce((sum, item) => sum + toCents(item.gross), 0n)),
      items,
    },
  };
}
