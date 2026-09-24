import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.ts';
import { migrateToLatest } from './migrate.ts';

const EXPECTED_COLUMNS: Record<string, string[]> = {
  'master_data.article': ['id', 'description', 'ean', 'price_net', 'price_gross', 'category'],
  'master_data.article_number': ['article_id', 'number'],
  'inventory.stocktake': ['id', 'name', 'status', 'started_at', 'finished_at'],
  'inventory.employee': ['id', 'stocktake_id', 'name', 'workstation_id', 'removed_at'],
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
    'employee_ids',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  'inventory.checkpoint': ['id', 'work_area_id', 'number', 'workstation_id', 'created_at'],
  'inventory.pairing': [
    'id',
    'workstation_id',
    'one_time_code',
    'qr_token',
    'valid_until',
    'device_token',
    'paired_at',
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
    expect(applied).toEqual(['0001_initial_schema']);
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

  it('keep employee names unique among employees that were not removed', async () => {
    const { id } = await test.db
      .insertInto('inventory.stocktake')
      .values({ name: 'Inventur' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await test.db
      .insertInto('inventory.employee')
      .values({ stocktake_id: id, name: 'Anna', removed_at: new Date() })
      .execute();
    await test.db
      .insertInto('inventory.employee')
      .values({ stocktake_id: id, name: 'Anna' })
      .execute();
    await expect(
      test.db.insertInto('inventory.employee').values({ stocktake_id: id, name: 'Anna' }).execute(),
    ).rejects.toThrow(/employee_name_idx/);
    await test.db.deleteFrom('inventory.stocktake').execute();
  });

  it('round-trip employee ids of an entry as numbers', async () => {
    const { id: stocktakeId } = await test.db
      .insertInto('inventory.stocktake')
      .values({ name: 'Inventur' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id: workAreaId } = await test.db
      .insertInto('inventory.work_area')
      .values({ stocktake_id: stocktakeId, name: 'Vitrine 1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const entry = await test.db
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
        workstation_id: null,
        employee_ids: [3, 12],
      })
      .returning(['id', 'employee_ids', 'quantity', 'price_gross'])
      .executeTakeFirstOrThrow();
    expect(entry).toMatchObject({ employee_ids: [3, 12], quantity: 1, price_gross: '99.90' });
    expect(typeof entry.id).toBe('number');
    await test.db.deleteFrom('inventory.entry').execute();
    await test.db.deleteFrom('inventory.stocktake').execute();
  });
});
