import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Checkpoints can be inserted after any line. Their position is a boundary
 * time: lines created until then lie before the checkpoint. The number is
 * derived from the order of the boundaries instead of being stored.
 */
/**
 * Every section before a checkpoint holds at least one line. Earlier
 * versions allowed empty sections; their checkpoints are removed.
 */
export async function removeCheckpointsOfEmptySections(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM inventory.checkpoint c
    USING (
      SELECT id, work_area_id, boundary_at,
             lag(boundary_at) OVER (PARTITION BY work_area_id ORDER BY boundary_at, id) AS previous
      FROM inventory.checkpoint
    ) b
    WHERE c.id = b.id
      AND NOT EXISTS (
        SELECT 1 FROM inventory.entry e
        WHERE e.work_area_id = b.work_area_id
          AND e.created_at <= b.boundary_at
          AND (b.previous IS NULL OR e.created_at > b.previous)
      )`.execute(db);
}

export const checkpointBoundary: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE inventory.checkpoint ADD COLUMN boundary_at TIMESTAMPTZ`.execute(db);
    await sql`UPDATE inventory.checkpoint SET boundary_at = created_at`.execute(db);
    await sql`ALTER TABLE inventory.checkpoint ALTER COLUMN boundary_at SET NOT NULL`.execute(db);
    await sql`ALTER TABLE inventory.checkpoint DROP COLUMN number`.execute(db);
    await sql`
      CREATE INDEX checkpoint_work_area_boundary_idx
        ON inventory.checkpoint (work_area_id, boundary_at)`.execute(db);
    await removeCheckpointsOfEmptySections(db);
  },
};
