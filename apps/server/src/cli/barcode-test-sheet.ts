import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '../db/connection.ts';
import { migrateToLatest } from '../db/migrate.ts';
import { createTestSheet } from '../test-sheet/create.ts';
import { parseInteger, randomSeed as defaultRandomSeed } from './args.ts';

export const USAGE = `Usage: barcode-test-sheet --output <file> [options]

Creates a printable PDF with barcodes from the current master data, one
section per lookup result: unique by EAN, unique by article number,
ambiguous and unknown.

Options:
  --output <file>  target PDF file (required)
  --count <n>      labels per section (default: 12)
  --seed <n>       seed for picking the articles; the same seed and master data
                   yield the same sheet (default: random, printed on completion)
  --help           show this help`;

export type TestSheetCommand =
  { help: true } | { help: false; output: string; count: number; seed: number };

export function parseTestSheetArgs(
  args: string[],
  randomSeed: () => number = defaultRandomSeed,
): TestSheetCommand {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      output: { type: 'string' },
      count: { type: 'string' },
      seed: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true };
  if (!values.output) throw new Error('--output is required');
  return {
    help: false,
    output: values.output,
    count: values.count === undefined ? 12 : parseInteger('count', values.count, 1),
    seed: values.seed === undefined ? randomSeed() : parseInteger('seed', values.seed, 0),
  };
}

async function main(): Promise<number> {
  let command: TestSheetCommand;
  try {
    command = parseTestSheetArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (command.help) {
    console.log(USAGE);
    return 0;
  }

  // pnpm runs scripts in the package directory; resolve relative to where it was invoked.
  const output = resolve(process.env.INIT_CWD ?? process.cwd(), command.output);
  const db = createDb(process.env.DATABASE_URL || undefined);
  try {
    await migrateToLatest(db);
    const { pdf, sheet, articleCount } = await createTestSheet(db, command);
    await writeFile(output, pdf);
    const counts = sheet.sections.map((s) => `${s.kind} ${s.labels.length}`).join(', ');
    console.log(
      `Wrote ${output} (${articleCount} articles; labels: ${counts}; seed ${command.seed}).`,
    );
    for (const section of sheet.sections) {
      if (section.labels.length === 0) {
        console.log(`Section ${section.kind} skipped: no matching master data.`);
      }
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
