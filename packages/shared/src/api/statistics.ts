import type { NamedRef } from './common.ts';
import type { WorkAreaStatus } from './work-area.ts';

/**
 * Lines, pieces and values of a set of entries. Amounts are decimal strings
 * in EUR. Manual articles have no net price, so they only count towards the
 * gross value.
 */
export interface StatisticsTotals {
  lines: number;
  /** Sum of the quantities. */
  quantity: number;
  net: string;
  gross: string;
}

export interface WorkAreaStatistics extends StatisticsTotals {
  id: number;
  name: string;
  status: WorkAreaStatus;
}

export interface CategoryStatistics extends Omit<StatisticsTotals, 'net'> {
  /** null for articles without a category. */
  category: string | null;
  /** The group of manually captured articles („ohne Kategorie (manuell)“). */
  manual: boolean;
  /** null for the manual group. */
  net: string | null;
}

/** Lines and pieces captured by an employee or at a workstation. */
export interface CaptureCount extends NamedRef {
  lines: number;
  quantity: number;
}

export interface RateBucket {
  /** ISO 8601 start of the interval. */
  start: string;
  lines: number;
  quantity: number;
}

export interface ManualEntryItem {
  id: number;
  workArea: NamedRef;
  description: string;
  /** The scanned or typed input, may be empty. */
  input: string;
  serialNumber: string | null;
  quantity: number;
  priceGross: string;
  /** Gross price × quantity. */
  gross: string;
  workstation: NamedRef;
  createdAt: string;
}

/** A single item of the master data captured in several lines or with a quantity above 1. */
export interface DuplicateArticle {
  articleId: number;
  description: string;
  ean: string | null;
  lines: number;
  quantity: number;
  workAreas: NamedRef[];
}

/** `GET /api/admin/stocktakes/:id/statistics` */
export interface StocktakeStatistics {
  stocktakeId: number;
  /** Work areas by status. */
  progress: Record<WorkAreaStatus, number> & { total: number };
  totals: StatisticsTotals;
  /** Ordered by name. */
  byWorkArea: WorkAreaStatistics[];
  /** Ordered by name; articles without a category and the manual group come last. */
  byCategory: CategoryStatistics[];
  /**
   * All employees of the stocktake, most lines first. A line captured by
   * several employees counts for each of them.
   */
  byEmployee: CaptureCount[];
  /** Workstations that captured lines in this stocktake, most lines first. */
  byWorkstation: CaptureCount[];
  /** Capture rate over time, from the first line until now or the end of the stocktake. */
  rate: { bucketMinutes: number; buckets: RateBucket[] };
  manual: { lines: number; quantity: number; gross: string; entries: ManualEntryItem[] };
  /** Most pieces first. */
  duplicates: DuplicateArticle[];
}

/** An article of the master data that was not captured (target 1, counted 0). */
export interface ShortageArticle {
  articleId: number;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string;
  priceGross: string;
}

export interface ShortageCategory {
  category: string | null;
  count: number;
  net: string;
  gross: string;
}

/**
 * - `excess`: an article of the master data counted more than once
 * - `unknown`: a captured article that is no longer in the master data
 * - `manual`: a manually captured line
 */
export type SurplusKind = 'excess' | 'unknown' | 'manual';

export interface SurplusItem {
  kind: SurplusKind;
  articleId: number | null;
  /** The line for `manual`, otherwise null. */
  entryId: number | null;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string | null;
  priceGross: string;
  /** Target quantity: 1 for `excess`, otherwise 0. */
  expected: number;
  counted: number;
  /** counted − expected */
  surplus: number;
  /** Value of the surplus; null for manual lines. */
  net: string | null;
  gross: string;
}

/**
 * `GET /api/admin/stocktakes/:id/reconciliation`: target/actual comparison
 * against the current master data. Every master data article is a single
 * item with a target quantity of 1.
 */
export interface Reconciliation {
  stocktakeId: number;
  /** Number of articles in the master data. */
  articleCount: number;
  shortage: {
    count: number;
    net: string;
    gross: string;
    /** Ordered by name, without category last. */
    byCategory: ShortageCategory[];
    /** Ordered by category and description; at most `SHORTAGE_LIST_LIMIT`. */
    articles: ShortageArticle[];
    truncated: boolean;
  };
  surplus: {
    /** Sum of the surplus quantities. */
    quantity: number;
    /** Manual lines have no net price and are not included. */
    net: string;
    gross: string;
    /** Excess and unknown articles by description, then manual lines by time. */
    items: SurplusItem[];
  };
}

/** Largest number of articles in the shortage list of the dashboard. */
export const SHORTAGE_LIST_LIMIT = 500;
