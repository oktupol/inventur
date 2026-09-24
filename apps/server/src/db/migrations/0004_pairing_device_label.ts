import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/** Workstations list their paired phones by the kind of device, e.g. "iPhone". */
export const pairingDeviceLabel: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE inventory.pairing ADD COLUMN device_label TEXT NULL`.execute(db);
    await sql`CREATE INDEX pairing_workstation_idx ON inventory.pairing (workstation_id)`.execute(
      db,
    );
  },
};
