import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * A workstation retries a scan whose response got lost, e.g. on a
 * connection drop. The request id it sends makes that retry idempotent.
 */
export const entryRequestId: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE inventory.entry ADD COLUMN request_id UUID NULL UNIQUE`.execute(db);
  },
};
