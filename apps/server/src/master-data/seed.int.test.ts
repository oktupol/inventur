import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import type { Db } from '../db/connection.ts';
import { migrateToLatest } from '../db/migrate.ts';
import { isValidEan13 } from '@inventur/shared';
import { MasterDataNotEmptyError, seedMasterData } from './seed.ts';

async function dump(db: Db) {
  const articles = await db.selectFrom('master_data.article').selectAll().orderBy('id').execute();
  const numbers = await db
    .selectFrom('master_data.article_number')
    .selectAll()
    .orderBy('article_id')
    .orderBy('number')
    .execute();
  return { articles, numbers };
}

describe('seedMasterData', () => {
  let first: TestDatabase;
  let second: TestDatabase;

  beforeAll(async () => {
    [first, second] = await Promise.all([createTestDatabase(), createTestDatabase()]);
    await Promise.all([migrateToLatest(first.db), migrateToLatest(second.db)]);
  });
  afterAll(async () => {
    await Promise.all([first.drop(), second.drop()]);
  });

  it('fills the master data tables', async () => {
    const result = await seedMasterData(first.db, { count: 2000, seed: 42, replace: false });
    const { articles, numbers } = await dump(first.db);
    expect(result).toEqual({ articles: 2000, articleNumbers: numbers.length });
    expect(articles).toHaveLength(2000);
    expect(numbers.length).toBeGreaterThan(2000);
  });

  it('stores only EAN-13 codes with a valid check digit', async () => {
    const { articles } = await dump(first.db);
    for (const { ean } of articles) if (ean !== null) expect(isValidEan13(ean), ean).toBe(true);
  });

  it('stores duplicate EANs for the ambiguous case', async () => {
    const duplicates = await first.db
      .selectFrom('master_data.article')
      .select('ean')
      .where('ean', 'is not', null)
      .groupBy('ean')
      .having((eb) => eb.fn.countAll(), '>', 1)
      .execute();
    expect(duplicates.length).toBeGreaterThan(0);
  });

  it('produces identical data for the same seed', async () => {
    await seedMasterData(second.db, { count: 2000, seed: 42, replace: false });
    expect(await dump(second.db)).toEqual(await dump(first.db));
  });

  it('aborts without --replace if master data exists', async () => {
    await expect(
      seedMasterData(first.db, { count: 10, seed: 1, replace: false }),
    ).rejects.toBeInstanceOf(MasterDataNotEmptyError);
    expect((await dump(first.db)).articles).toHaveLength(2000);
  });

  it('replaces existing master data with --replace', async () => {
    await seedMasterData(first.db, { count: 10, seed: 1, replace: true });
    const { articles } = await dump(first.db);
    expect(articles.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('advances the id sequence past the seeded articles', async () => {
    const { id } = await first.db
      .insertInto('master_data.article')
      .values({
        description: 'Neu',
        ean: null,
        price_net: '1.00',
        price_gross: '1.19',
        category: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(id).toBe(11);
  });
});
