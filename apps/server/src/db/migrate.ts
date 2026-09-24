import { Migrator } from 'kysely/migration';
import type { Db } from './connection.ts';
import { migrationProvider } from './migrations/index.ts';

/** Brings the schema up to date and returns the names of the executed migrations. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: migrationProvider,
    migrationTableSchema: 'inventory',
  });
  const { error, results = [] } = await migrator.migrateToLatest();
  if (error) {
    const failed = results.find((r) => r.status === 'Error')?.migrationName ?? 'unknown';
    throw new Error(`Migration failed: ${failed}`, { cause: error });
  }
  return results.filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
