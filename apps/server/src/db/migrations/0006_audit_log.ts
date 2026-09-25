import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Audit log of later changes to lines and of finishing and reopening a
 * stocktake. Rows are never changed. Entries, work areas and workstations
 * are referenced without foreign keys because they may be deleted; names are
 * kept as snapshots.
 */
export const auditLog: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      CREATE TABLE inventory.audit_log (
        id                BIGSERIAL   PRIMARY KEY,
        stocktake_id      BIGINT      NOT NULL REFERENCES inventory.stocktake(id) ON DELETE CASCADE,
        action            TEXT        NOT NULL CHECK (action IN (
                            'quantity_changed', 'serial_number_changed', 'deleted', 'restored',
                            'stocktake_finished', 'stocktake_reopened')),
        entry_id          BIGINT      NULL,
        work_area_id      BIGINT      NULL,
        work_area_name    TEXT        NULL,
        description       TEXT        NULL,
        code              TEXT        NULL,
        old_value         TEXT        NULL,
        new_value         TEXT        NULL,
        entry_snapshot    JSONB       NULL,
        source            TEXT        NOT NULL CHECK (source IN ('station', 'phone', 'admin')),
        workstation_id    BIGINT      NULL,
        workstation_name  TEXT        NULL,
        employee_names    TEXT[]      NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.execute(db);
    await sql`
      CREATE INDEX audit_log_stocktake_idx ON inventory.audit_log (stocktake_id, id)`.execute(db);
    await sql`CREATE INDEX audit_log_entry_idx ON inventory.audit_log (entry_id)`.execute(db);
  },
};
