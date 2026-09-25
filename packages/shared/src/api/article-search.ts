import type { AuditLogEntry } from './audit-log.ts';
import type { NamedRef } from './common.ts';

/** How an article or line matched the search in a stocktake. */
export type StocktakeMatchField =
  | 'ean'
  | 'article_number'
  | 'description'
  | 'serial_number'
  /** The scanned or typed input of a line. */
  | 'input';

/** A line as the article search shows it: where, when and by whom it was captured. */
export interface FoundEntry {
  id: number;
  articleId: number | null;
  isManual: boolean;
  description: string;
  /** EAN, otherwise the scanned or typed input. */
  code: string | null;
  serialNumber: string | null;
  quantity: number;
  priceGross: string;
  workArea: NamedRef;
  workstation: NamedRef;
  employees: string[];
  createdAt: string;
}

/**
 * An article with what was captured of it in the stocktake. Description,
 * codes and target quantity come from the current master data; an article
 * that is no longer there shows the snapshot of its newest line.
 */
export interface FoundArticle {
  articleId: number;
  description: string;
  ean: string | null;
  articleNumbers: string[];
  category: string | null;
  priceGross: string | null;
  inMasterData: boolean;
  /** Target quantity from the master data; null without one. */
  expectedQuantity: number | null;
  /** Sum of the quantities of its lines in the stocktake. */
  countedQuantity: number;
  lines: number;
}

/** `GET /api/admin/stocktakes/:id/articles/search?q=` */
export interface StocktakeArticleSearchResponse {
  articles: (FoundArticle & { matchedBy: StocktakeMatchField })[];
  /** Manually captured lines matching by description, input or serial number. */
  manualEntries: (FoundEntry & { matchedBy: StocktakeMatchField })[];
  /** More articles or manual lines match than were returned. */
  hasMore: boolean;
}

/** `GET /api/admin/stocktakes/:id/articles/:articleId` */
export interface StocktakeArticleDetail {
  article: FoundArticle;
  /** Its lines, oldest first. */
  entries: FoundEntry[];
  /** Changes to its lines, newest first, also of lines deleted since. */
  auditLog: AuditLogEntry[];
}
