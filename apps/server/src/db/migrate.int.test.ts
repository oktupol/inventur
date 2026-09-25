import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { removeCheckpointsOfEmptySections } from './migrations/0003_checkpoint_boundary.ts';
import { migrateToLatest } from './migrate.ts';

const EXPECTED_COLUMNS: Record<string, string[]> = {
  'master_data.article': [
    'id',
    'description',
    'ean',
    'price_net',
    'price_gross',
    'category',
    'expected_quantity',
  ],
  'master_data.article_number': ['article_id', 'number'],
  'inventory.stocktake': ['id', 'name', 'status', 'started_at', 'finished_at'],
  'inventory.employee': ['id', 'stocktake_id', 'name', 'workstation_id'],
  'inventory.workstation': ['id', 'name', 'token', 'work_area_id', 'last_seen_at'],
  'inventory.work_area': ['id', 'stocktake_id', 'name', 'description', 'status', 'closed_at'],
  'inventory.entry': [
    'id',
    'stocktake_id',
    'work_area_id',
    'article_id',
    'is_manual',
    'input',
    'description',
    'ean',
    'category',
    'price_net',
    'price_gross',
    'serial_number',
    'quantity',
    'workstation_id',
    'created_at',
    'updated_at',
    'request_id',
  ],
  'inventory.entry_employee': ['entry_id', 'employee_id'],
  'inventory.checkpoint': ['id', 'work_area_id', 'workstation_id', 'created_at', 'boundary_at'],
  'inventory.pairing': [
    'id',
    'workstation_id',
    'one_time_code',
    'qr_token',
    'valid_until',
    'device_token',
    'paired_at',
    'device_label',
  ],
  'inventory.audit_log': [
    'id',
    'stocktake_id',
    'action',
    'entry_id',
    'work_area_id',
    'work_area_name',
    'description',
    'code',
    'old_value',
    'new_value',
    'entry_snapshot',
    'source',
    'workstation_id',
    'workstation_name',
    'employee_names',
    'created_at',
  ],
};

describe('migrations', () => {
  let test: TestDatabase;
  let applied: string[];

  beforeAll(async () => {
    test = await createTestDatabase();
    applied = await migrateToLatest(test.db);
  });
  afterAll(() => test.drop());

  it('run on an empty database', () => {
    expect(applied).toEqual([
      '0001_initial_schema',
      '0002_entry_request_id',
      '0003_checkpoint_boundary',
      '0004_pairing_device_label',
      '0005_article_expected_quantity',
      '0006_audit_log',
    ]);
  });

  it('do nothing when run again', async () => {
    expect(await migrateToLatest(test.db)).toEqual([]);
  });

  it('create all tables with the expected columns', async () => {
    const { rows } = await sql<{ table: string; column: string }>`
      SELECT table_schema || '.' || table_name AS table, column_name AS column
      FROM information_schema.columns
      WHERE table_schema IN ('master_data', 'inventory')
        AND table_name NOT LIKE 'kysely_%'
      ORDER BY table_schema, table_name, ordinal_position
    `.execute(test.db);
    const actual: Record<string, string[]> = {};
    for (const row of rows) (actual[row.table] ??= []).push(row.column);
    expect(actual).toEqual(EXPECTED_COLUMNS);
  });

  it('install pg_trgm and the search indexes', async () => {
    const extensions = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `.execute(test.db);
    expect(extensions.rows).toHaveLength(1);

    const indexes = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'master_data' ORDER BY indexname
    `.execute(test.db);
    expect(indexes.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        'article_description_trgm_idx',
        'article_ean_idx',
        'article_number_number_idx',
      ]),
    );
  });

  it('allow at most one active stocktake', async () => {
    await test.db.insertInto('inventory.stocktake').values({ name: 'Inventur 2025' }).execute();
    await expect(
      test.db.insertInto('inventory.stocktake').values({ name: 'Inventur 2026' }).execute(),
    ).rejects.toThrow(/stocktake_single_active_idx/);
    await test.db.deleteFrom('inventory.stocktake').execute();
  });

  it('keep employee names unique within a stocktake', async () => {
    const { id } = await test.db
      .insertInto('inventory.stocktake')
      .values({ name: 'Inventur' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await test.db
      .insertInto('inventory.employee')
      .values({ stocktake_id: id, name: 'Anna' })
      .execute();
    await expect(
      test.db.insertInto('inventory.employee').values({ stocktake_id: id, name: 'Anna' }).execute(),
    ).rejects.toThrow(/employee_stocktake_id_name_key/);
    await test.db.deleteFrom('inventory.employee').execute();
    await test.db.deleteFrom('inventory.stocktake').execute();
  });

  describe('deleting employees and workstations', () => {
    let stocktakeId: number;
    let workAreaId: number;

    beforeAll(async () => {
      ({ id: stocktakeId } = await test.db
        .insertInto('inventory.stocktake')
        .values({ name: 'Inventur' })
        .returning('id')
        .executeTakeFirstOrThrow());
      ({ id: workAreaId } = await test.db
        .insertInto('inventory.work_area')
        .values({ stocktake_id: stocktakeId, name: 'Vitrine 1' })
        .returning('id')
        .executeTakeFirstOrThrow());
    });

    async function createWorkstation(name: string): Promise<number> {
      const { id } = await test.db
        .insertInto('inventory.workstation')
        .values({ name, token: `token-${name}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    }

    async function createEmployee(name: string, workstationId: number | null): Promise<number> {
      const { id } = await test.db
        .insertInto('inventory.employee')
        .values({ stocktake_id: stocktakeId, name, workstation_id: workstationId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    }

    async function createEntry(workstationId: number, employeeIds: number[]): Promise<number> {
      const { id } = await test.db
        .insertInto('inventory.entry')
        .values({
          stocktake_id: stocktakeId,
          work_area_id: workAreaId,
          article_id: null,
          is_manual: true,
          input: 'XYZ',
          description: 'Unbekannter Ring',
          ean: null,
          category: null,
          price_net: null,
          price_gross: '99.90',
          serial_number: null,
          workstation_id: workstationId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await test.db
        .insertInto('inventory.entry_employee')
        .values(employeeIds.map((employee_id) => ({ entry_id: id, employee_id })))
        .execute();
      return id;
    }

    it('succeeds without entries and logs employees out of a deleted workstation', async () => {
      const workstationId = await createWorkstation('Kasse');
      const employeeId = await createEmployee('Ben', workstationId);
      await test.db.deleteFrom('inventory.workstation').where('id', '=', workstationId).execute();
      const employee = await test.db
        .selectFrom('inventory.employee')
        .select('workstation_id')
        .where('id', '=', employeeId)
        .executeTakeFirstOrThrow();
      expect(employee.workstation_id).toBeNull();
      await test.db.deleteFrom('inventory.employee').where('id', '=', employeeId).execute();
    });

    it('is rejected while they have entries and allowed once the entries are deleted', async () => {
      const workstationId = await createWorkstation('Lager');
      const employeeId = await createEmployee('Cem', workstationId);
      const entryId = await createEntry(workstationId, [employeeId]);

      await expect(
        test.db.deleteFrom('inventory.employee').where('id', '=', employeeId).execute(),
      ).rejects.toThrow(/entry_employee_employee_id_fkey/);
      await expect(
        test.db.deleteFrom('inventory.workstation').where('id', '=', workstationId).execute(),
      ).rejects.toThrow(/entry_workstation_id_fkey/);

      // Deleting an entry is permanent and also removes its employee links.
      await test.db.deleteFrom('inventory.entry').where('id', '=', entryId).execute();
      const links = await test.db
        .selectFrom('inventory.entry_employee')
        .selectAll()
        .where('entry_id', '=', entryId)
        .execute();
      expect(links).toEqual([]);
      await test.db.deleteFrom('inventory.employee').where('id', '=', employeeId).execute();
      await test.db.deleteFrom('inventory.workstation').where('id', '=', workstationId).execute();
    });
  });
});

describe('migration 0003', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase();
    await migrateToLatest(test.db);
  });
  afterAll(() => test.drop());

  it('removes checkpoints whose section is empty', async () => {
    const { id: stocktakeId } = await test.db
      .insertInto('inventory.stocktake')
      .values({ name: 'Inventur' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id: workAreaId } = await test.db
      .insertInto('inventory.work_area')
      .values({ stocktake_id: stocktakeId, name: 'Lager' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id: workstationId } = await test.db
      .insertInto('inventory.workstation')
      .values({ name: 'Kasse', token: 't' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute));
    await test.db
      .insertInto('inventory.entry')
      .values(
        [1, 5].map((minute) => ({
          stocktake_id: stocktakeId,
          work_area_id: workAreaId,
          article_id: null,
          is_manual: true,
          input: '',
          description: 'Ring',
          ean: null,
          category: null,
          price_net: null,
          price_gross: '1.00',
          serial_number: null,
          workstation_id: workstationId,
          created_at: at(minute),
        })),
      )
      .execute();
    // Sections: [entry 10:01] cp 10:02, [] cp 10:03, [] cp 10:04, [entry 10:05] cp 10:06
    await test.db
      .insertInto('inventory.checkpoint')
      .values([2, 3, 4, 6].map((minute) => ({ work_area_id: workAreaId, boundary_at: at(minute) })))
      .execute();

    await removeCheckpointsOfEmptySections(test.db as unknown as Kysely<unknown>);

    const remaining = await test.db
      .selectFrom('inventory.checkpoint')
      .select('boundary_at')
      .orderBy('boundary_at')
      .execute();
    expect(remaining.map((c) => new Date(c.boundary_at).getUTCMinutes())).toEqual([2, 6]);
  });
});
