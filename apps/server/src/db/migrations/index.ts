import type { Migration, MigrationProvider } from 'kysely/migration';
import { initialSchema } from './0001_initial_schema.ts';
import { entryRequestId } from './0002_entry_request_id.ts';
import { checkpointBoundary } from './0003_checkpoint_boundary.ts';
import { pairingDeviceLabel } from './0004_pairing_device_label.ts';
import { articleExpectedQuantity } from './0005_article_expected_quantity.ts';

/** All migrations in order. Append new migrations here. */
const migrations: Record<string, Migration> = {
  '0001_initial_schema': initialSchema,
  '0002_entry_request_id': entryRequestId,
  '0003_checkpoint_boundary': checkpointBoundary,
  '0004_pairing_device_label': pairingDeviceLabel,
  '0005_article_expected_quantity': articleExpectedQuantity,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
