import type { Migration, MigrationProvider } from 'kysely/migration';
import { initialSchema } from './0001_initial_schema.ts';
import { entryRequestId } from './0002_entry_request_id.ts';
import { checkpointBoundary } from './0003_checkpoint_boundary.ts';

/** All migrations in order. Append new migrations here. */
const migrations: Record<string, Migration> = {
  '0001_initial_schema': initialSchema,
  '0002_entry_request_id': entryRequestId,
  '0003_checkpoint_boundary': checkpointBoundary,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
