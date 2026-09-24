import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { migrateToLatest } from '../db/migrate.ts';
import { seedMasterData } from '../master-data/seed.ts';
import { createTestSheet } from './create.ts';
import { loadSheetArticles } from './load.ts';

describe('createTestSheet', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase();
    await migrateToLatest(test.db);
  });
  afterAll(() => test.drop());

  it('skips all but the unknown section when there is no master data', async () => {
    const { sheet, articleCount } = await createTestSheet(test.db, { count: 4, seed: 1 });
    expect(articleCount).toBe(0);
    expect(sheet.sections.map((s) => s.labels.length)).toEqual([0, 0, 0, 4]);
  });

  it('loads articles with their article numbers', async () => {
    await seedMasterData(test.db, { count: 500, seed: 42, replace: false });
    const articles = await loadSheetArticles(test.db);
    expect(articles).toHaveLength(500);
    const withNumbers = articles.find((a) => a.articleNumbers.length > 1)!;
    const stored = await test.db
      .selectFrom('master_data.article_number')
      .select('number')
      .where('article_id', '=', withNumbers.id)
      .orderBy('number')
      .execute();
    expect(withNumbers.articleNumbers).toEqual(stored.map((r) => r.number));
  });

  it('creates a PDF with all four sections from seeded master data', async () => {
    const { pdf, sheet } = await createTestSheet(test.db, { count: 3, seed: 7 });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sheet.sections.map((s) => s.labels.length)).toEqual([3, 3, 3, 3]);
  });
});
