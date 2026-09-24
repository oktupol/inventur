import type { Db } from '../db/connection.ts';
import { renderPdf } from '../pdf/render.ts';
import { testSheetDocument } from './document.ts';
import { loadSheetArticles } from './load.ts';
import { selectTestSheet, type SelectionOptions, type TestSheet } from './selection.ts';

export interface CreatedTestSheet {
  pdf: Buffer;
  sheet: TestSheet;
  articleCount: number;
}

/** Creates the barcode test sheet PDF from the current master data. */
export async function createTestSheet(
  db: Db,
  options: SelectionOptions,
  createdAt = new Date(),
): Promise<CreatedTestSheet> {
  const articles = await loadSheetArticles(db);
  const sheet = selectTestSheet(articles, options);
  const pdf = await renderPdf(
    testSheetDocument(sheet, { createdAt, seed: options.seed, articleCount: articles.length }),
  );
  return { pdf, sheet, articleCount: articles.length };
}
