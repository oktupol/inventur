import type { DomainEvent } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { migrateToLatest } from '../src/db/migrate.ts';
import { EventBus } from '../src/realtime/event-bus.ts';
import { createTestDatabase, type TestDatabase } from './database.ts';

export interface TestApp extends TestDatabase {
  app: FastifyInstance;
  /** Events published since the last call of `takeEvents`. */
  takeEvents(): DomainEvent[];
  close(): Promise<void>;
}

/** An app on its own migrated test database that records published events. */
export async function createTestApp(options: { publicHost?: string } = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  await migrateToLatest(database.db);
  const events = new EventBus();
  let recorded: DomainEvent[] = [];
  events.subscribe((event) => recorded.push(event));
  const app = await buildApp({ version: 'test', db: database.db, events, ...options });
  return {
    ...database,
    app,
    takeEvents() {
      const taken = recorded;
      recorded = [];
      return taken;
    },
    async close() {
      await app.close();
      await database.drop();
    },
  };
}
