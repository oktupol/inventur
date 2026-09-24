import type { ArticleMatch } from './article.ts';
import type { NamedRef } from './common.ts';
import type { WorkAreaStatus } from './work-area.ts';

/** A counted line: an article with a quantity in a work area, with a snapshot of its master data. */
export interface Entry {
  id: number;
  workAreaId: number;
  articleId: number | null;
  isManual: boolean;
  /** The scanned or typed input. */
  input: string;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string | null;
  priceGross: string;
  serialNumber: string | null;
  quantity: number;
  workstation: NamedRef;
  createdAt: string;
  updatedAt: string;
  /**
   * Other lines of the same article in this stocktake. Master data articles
   * are single items, so a value above 0 hints at a double scan.
   */
  duplicateCount: number;
}

export interface EntryTotals {
  /** Sum of the quantities, the number of pieces. */
  quantity: number;
  lines: number;
  /** Sum of gross price × quantity, a decimal string in EUR. */
  grossValue: string;
}

/** `GET /api/station/entries`: the lines of the workstation's work area, newest first. */
export interface EntryListResponse {
  workArea: NamedRef & { status: WorkAreaStatus };
  entries: Entry[];
  totals: EntryTotals;
}

/** `POST /api/station/entries` */
export interface CreateEntryRequest {
  input: string;
  /** The article chosen from an ambiguous result; without it, the input is resolved. */
  articleId?: number;
  /** Chosen by the workstation per scan; a repeated request returns the line created before. */
  requestId?: string;
}

export type CreateEntryResponse =
  | { result: 'unique'; entry: Entry }
  | { result: 'ambiguous'; articles: ArticleMatch[]; hasMore: boolean }
  | { result: 'not_found' };

/** Largest quantity of a line. */
export const MAX_QUANTITY = 99_999;

/**
 * `PATCH /api/station/entries/:id`: set the quantity, or change it by
 * `delta` (+1/−1). A decrement never goes below 1.
 */
export type UpdateEntryRequest = { quantity: number } | { delta: number };
