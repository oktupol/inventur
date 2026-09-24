import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.ts';

// Read BIGINT (type 20) as number; IDs stay far below Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (value) => Number(value));
// BIGINT[] (type 1016), e.g. entry.employee_ids. Contains only numbers, so no quoting.
// The typings only list scalar type ids, hence the cast.
const BIGINT_ARRAY = 1016 as Parameters<typeof pg.types.setTypeParser>[0];
pg.types.setTypeParser(BIGINT_ARRAY, (value: string) =>
  value === '{}' ? [] : value.slice(1, -1).split(',').map(Number),
);

export type Db = Kysely<Database>;

/**
 * Creates the database connection. Without `connectionString`, the standard
 * Postgres variables apply (`PGHOST`, `PGUSER`, `PGPASSWORD`, …).
 */
export function createDb(connectionString?: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
