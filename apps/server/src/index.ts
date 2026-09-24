import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/connection.ts';
import { migrateToLatest } from './db/migrate.ts';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp(config);

const applied = await migrateToLatest(db);
app.log.info({ migrations: applied }, `Applied ${applied.length} migration(s)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
