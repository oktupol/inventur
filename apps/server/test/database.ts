import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, type Db } from '../src/db/connection.ts';

export interface TestDatabase {
  db: Db;
  url: string;
  drop(): Promise<void>;
}

async function adminQuery(query: string): Promise<void> {
  const client = new pg.Client({ connectionString: inject('databaseUrl') });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

/** Creates an empty, isolated database in the test container. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await adminQuery(`CREATE DATABASE ${name}`);
  const url = new URL(inject('databaseUrl'));
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  return {
    db,
    url: url.toString(),
    async drop() {
      await db.destroy();
      // The pool may still be closing its connections. Dropping WITH (FORCE)
      // would terminate them and cause unhandled errors, so wait instead.
      for (let attempt = 1; ; attempt++) {
        try {
          await adminQuery(`DROP DATABASE ${name}`);
          return;
        } catch (error) {
          const inUse = (error as { code?: string }).code === '55006';
          if (!inUse || attempt >= 50) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
  };
}
