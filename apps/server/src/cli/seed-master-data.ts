import { parseArgs } from 'node:util';
import { createDb } from '../db/connection.ts';
import { migrateToLatest } from '../db/migrate.ts';
import { MasterDataNotEmptyError, seedMasterData, type SeedOptions } from '../master-data/seed.ts';

export const USAGE = `Usage: seed-master-data [options]

Fills the master data tables with dummy data for tests and demos.

Options:
  --count <n>    number of articles (default: 5000)
  --seed <n>     seed for the random generator; the same seed yields the same data
                 (default: random, printed on completion)
  --replace      delete existing master data first
  --help         show this help`;

export type SeedCommand = { help: true } | ({ help: false } & SeedOptions);

function parseInteger(name: string, value: string, min: number): number {
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min) {
    throw new Error(`--${name} must be an integer >= ${min}, got: ${value}`);
  }
  return number;
}

export function parseSeedArgs(
  args: string[],
  randomSeed: () => number = () => Math.floor(Math.random() * 2 ** 31),
): SeedCommand {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      count: { type: 'string' },
      seed: { type: 'string' },
      replace: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true };
  return {
    help: false,
    count: values.count === undefined ? 5000 : parseInteger('count', values.count, 1),
    seed: values.seed === undefined ? randomSeed() : parseInteger('seed', values.seed, 0),
    replace: values.replace,
  };
}

async function main(): Promise<number> {
  let command: SeedCommand;
  try {
    command = parseSeedArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (command.help) {
    console.log(USAGE);
    return 0;
  }

  const db = createDb(process.env.DATABASE_URL || undefined);
  try {
    await migrateToLatest(db);
    const started = performance.now();
    const result = await seedMasterData(db, command);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `Created ${result.articles} articles with ${result.articleNumbers} article numbers ` +
        `in ${seconds} s (seed ${command.seed}).`,
    );
    return 0;
  } catch (error) {
    if (error instanceof MasterDataNotEmptyError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
