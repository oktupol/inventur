import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { generateMasterData, type GeneratorOptions } from './generator.ts';

export interface SeedOptions extends GeneratorOptions {
  /** Deletes existing master data first. Without it, seeding aborts if data exists. */
  replace: boolean;
}

export interface SeedResult {
  articles: number;
  articleNumbers: number;
}

export class MasterDataNotEmptyError extends Error {
  constructor() {
    super('Master data already exists. Use --replace to delete it first.');
    this.name = 'MasterDataNotEmptyError';
  }
}

const BATCH_SIZE = 1000;

function* batches<T>(items: T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) yield items.slice(i, i + BATCH_SIZE);
}

/** Loads dummy master data into the same tables as real master data. */
export async function seedMasterData(db: Db, options: SeedOptions): Promise<SeedResult> {
  const articles = generateMasterData(options);

  return db.transaction().execute(async (trx) => {
    // Prevent concurrent writers between the emptiness check and the inserts.
    await sql`LOCK TABLE master_data.article, master_data.article_number IN EXCLUSIVE MODE`.execute(
      trx,
    );

    const existing = await trx.selectFrom('master_data.article').select('id').limit(1).execute();
    if (existing.length > 0) {
      if (!options.replace) throw new MasterDataNotEmptyError();
      await sql`TRUNCATE master_data.article, master_data.article_number RESTART IDENTITY`.execute(
        trx,
      );
    }

    // Explicit ids keep the data identical for the same seed.
    for (const batch of batches(articles)) {
      await trx
        .insertInto('master_data.article')
        .values(
          batch.map((a) => ({
            id: a.id,
            description: a.description,
            ean: a.ean,
            price_net: a.priceNet,
            price_gross: a.priceGross,
            category: a.category,
          })),
        )
        .execute();
    }

    const numbers = articles.flatMap((a) =>
      a.articleNumbers.map((number) => ({ article_id: a.id, number })),
    );
    for (const batch of batches(numbers)) {
      await trx.insertInto('master_data.article_number').values(batch).execute();
    }

    await sql`
      SELECT setval(pg_get_serial_sequence('master_data.article', 'id'), ${articles.length})
    `.execute(trx);

    return { articles: articles.length, articleNumbers: numbers.length };
  });
}
