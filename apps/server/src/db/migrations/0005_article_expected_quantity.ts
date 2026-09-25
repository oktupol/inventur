import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Target quantity of an article for the target/actual comparison. Articles
 * without one are left out of the comparison.
 */
export const articleExpectedQuantity: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      ALTER TABLE master_data.article
        ADD COLUMN expected_quantity INTEGER NULL CHECK (expected_quantity >= 0)`.execute(db);
  },
};
