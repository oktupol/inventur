import type { ArticleMatch } from './article.ts';
import type { Checkpoint } from './checkpoint.ts';
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
   * Other lines of the same article in this stocktake if it is a single item
   * (target quantity 1), otherwise 0. A value above 0 hints at a double scan.
   */
  duplicateCount: number;
  /**
   * Number of the checkpoint that follows the line, i.e. whose section it
   * belongs to; null for lines after the newest checkpoint.
   */
  checkpointNumber: number | null;
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
  /** Newest first. */
  checkpoints: Checkpoint[];
  /** Pieces captured after the newest checkpoint (or since the start without one). */
  sinceLastCheckpoint: number;
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

/**
 * `POST /api/station/entries/manual`: an article that is not in the master
 * data. It has no net price and no category.
 */
export interface CreateManualEntryRequest {
  /** The original input, e.g. the unknown scanned code; empty without a scan. */
  input: string;
  description: string;
  /** Gross price in EUR as a decimal string with a dot, e.g. "129.90"; greater than 0. */
  priceGross: string;
  serialNumber?: string | null;
  requestId?: string;
}

/**
 * Parses a price as typed in German, e.g. "129,90", "1.299,00", "1299.9" or
 * "12 €", into a decimal string with a dot ("129.90"). Returns null for
 * invalid prices and prices of 0.
 */
export function parsePrice(text: string): string | null {
  let value = text.replace(/€|\s/g, '');
  if (value.includes(',')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    // A dot followed by groups of three digits separates thousands.
    value = value.replace(/\./g, '');
  }
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const price = `${BigInt(match[1]!)}.${(match[2] ?? '').padEnd(2, '0')}`;
  return Number(price) > 0 ? price : null;
}

/** `DELETE /api/station/entries/:id` */
export interface DeleteEntryResponse {
  /**
   * Numbers of checkpoints removed because the deleted line was the last one
   * of their section (numbers before the removal).
   */
  removedCheckpoints: number[];
}
