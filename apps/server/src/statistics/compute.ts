import type {
  CaptureCount,
  CategoryStatistics,
  ManualEntryItem,
  NamedRef,
  OvercountedArticle,
  RateBucket,
  StatisticsTotals,
  StocktakeStatistics,
  WorkAreaStatistics,
  WorkAreaStatus,
} from '@inventur/shared';
import { fromCents, lineCents } from '../money.ts';

/** Key figures of a stocktake, independent of the database. */

export interface StatisticsEntry {
  id: number;
  workAreaId: number;
  articleId: number | null;
  isManual: boolean;
  input: string;
  description: string;
  ean: string | null;
  category: string | null;
  priceNet: string | null;
  priceGross: string;
  serialNumber: string | null;
  quantity: number;
  workstationId: number;
  createdAt: Date;
  employeeIds: readonly number[];
}

export interface StatisticsInput {
  stocktakeId: number;
  workAreas: readonly (NamedRef & { status: WorkAreaStatus })[];
  employees: readonly NamedRef[];
  workstations: readonly NamedRef[];
  /** Target quantities of the captured articles in the current master data; absent without one. */
  expectedQuantities: ReadonlyMap<number, number>;
  entries: readonly StatisticsEntry[];
  /** End of the capture rate: now, or the end of a finished stocktake. */
  until: Date;
}

/** Pieces and values of a line in cents; manual lines have a net value of 0. */
interface Line {
  quantity: number;
  net: bigint;
  gross: bigint;
}

class Sum {
  lines = 0;
  quantity = 0;
  net = 0n;
  gross = 0n;

  add(line: Line): void {
    this.lines += 1;
    this.quantity += line.quantity;
    this.net += line.net;
    this.gross += line.gross;
  }

  totals(): StatisticsTotals {
    return {
      lines: this.lines,
      quantity: this.quantity,
      net: fromCents(this.net),
      gross: fromCents(this.gross),
    };
  }
}

function sumOf<K>(sums: Map<K, Sum>, key: K): Sum {
  let sum = sums.get(key);
  if (!sum) {
    sum = new Sum();
    sums.set(key, sum);
  }
  return sum;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function byName(a: { name: string }, b: { name: string }): number {
  return collator.compare(a.name, b.name);
}

function byLines(a: CaptureCount, b: CaptureCount): number {
  return b.lines - a.lines || b.quantity - a.quantity || byName(a, b);
}

/** Interval lengths of the capture rate in minutes. */
const BUCKET_MINUTES = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];
/** The shortest interval is chosen that keeps the number of intervals at or below this. */
export const MAX_BUCKETS = 48;

/**
 * Pieces and lines per interval between the first line and `until`.
 * Intervals start at multiples of their length, empty ones are included.
 */
export function captureRate(
  entries: readonly Pick<StatisticsEntry, 'createdAt' | 'quantity'>[],
  until: Date,
): StocktakeStatistics['rate'] {
  if (entries.length === 0) return { bucketMinutes: BUCKET_MINUTES[0]!, buckets: [] };
  const times = entries.map((entry) => entry.createdAt.getTime());
  // A loop instead of spreading, which fails for very many lines.
  let first = Infinity;
  let last = until.getTime();
  for (const time of times) {
    first = Math.min(first, time);
    last = Math.max(last, time);
  }
  const bucketMinutes =
    BUCKET_MINUTES.find((minutes) => {
      const size = minutes * 60_000;
      return Math.floor(last / size) - Math.floor(first / size) + 1 <= MAX_BUCKETS;
    }) ?? BUCKET_MINUTES.at(-1)!;
  const size = bucketMinutes * 60_000;
  const start = Math.floor(first / size) * size;
  const buckets: RateBucket[] = [];
  for (let at = start; at <= last; at += size) {
    buckets.push({ start: new Date(at).toISOString(), lines: 0, quantity: 0 });
  }
  entries.forEach((entry, index) => {
    const bucket = buckets[Math.floor((times[index]! - start) / size)]!;
    bucket.lines += 1;
    bucket.quantity += entry.quantity;
  });
  return { bucketMinutes, buckets };
}

function categoryKey(entry: StatisticsEntry): string {
  if (entry.isManual) return 'manual';
  return entry.category === null ? 'none' : `category:${entry.category}`;
}

export function computeStatistics(input: StatisticsInput): StocktakeStatistics {
  const workAreaNames = new Map(input.workAreas.map((area) => [area.id, area.name]));
  const workstationNames = new Map(input.workstations.map((w) => [w.id, w.name]));
  const ref = (names: Map<number, string>, id: number): NamedRef => ({
    id,
    name: names.get(id) ?? '',
  });

  const total = new Sum();
  const areaSums = new Map<number, Sum>();
  const categorySums = new Map<string, { category: string | null; manual: boolean; sum: Sum }>();
  const employeeSums = new Map<number, Sum>();
  const workstationSums = new Map<number, Sum>();
  const manualSum = new Sum();
  const manualEntries: ManualEntryItem[] = [];
  const articles = new Map<
    number,
    { entry: StatisticsEntry; lines: number; quantity: number; workAreaIds: Set<number> }
  >();

  for (const entry of input.entries) {
    const line: Line = {
      quantity: entry.quantity,
      net: entry.priceNet === null ? 0n : lineCents(entry.priceNet, entry.quantity),
      gross: lineCents(entry.priceGross, entry.quantity),
    };
    total.add(line);
    sumOf(areaSums, entry.workAreaId).add(line);
    sumOf(workstationSums, entry.workstationId).add(line);
    for (const employeeId of new Set(entry.employeeIds)) sumOf(employeeSums, employeeId).add(line);

    const key = categoryKey(entry);
    let category = categorySums.get(key);
    if (!category) {
      category = {
        category: entry.isManual ? null : entry.category,
        manual: entry.isManual,
        sum: new Sum(),
      };
      categorySums.set(key, category);
    }
    category.sum.add(line);

    if (entry.isManual) {
      manualSum.add(line);
      manualEntries.push({
        id: entry.id,
        workArea: ref(workAreaNames, entry.workAreaId),
        description: entry.description,
        input: entry.input,
        serialNumber: entry.serialNumber,
        quantity: entry.quantity,
        priceGross: entry.priceGross,
        gross: fromCents(line.gross),
        workstation: ref(workstationNames, entry.workstationId),
        createdAt: entry.createdAt.toISOString(),
      });
    } else if (entry.articleId !== null) {
      const article = articles.get(entry.articleId);
      if (article) {
        article.lines += 1;
        article.quantity += entry.quantity;
        article.workAreaIds.add(entry.workAreaId);
      } else {
        articles.set(entry.articleId, {
          entry,
          lines: 1,
          quantity: entry.quantity,
          workAreaIds: new Set([entry.workAreaId]),
        });
      }
    }
  }

  const progress = { open: 0, in_progress: 0, closed: 0, total: input.workAreas.length };
  for (const area of input.workAreas) progress[area.status] += 1;

  const byWorkArea: WorkAreaStatistics[] = input.workAreas
    .map((area) => ({
      id: area.id,
      name: area.name,
      status: area.status,
      ...(areaSums.get(area.id) ?? new Sum()).totals(),
    }))
    .sort(byName);

  const categoryRank = (c: CategoryStatistics) => (c.manual ? 2 : c.category === null ? 1 : 0);
  const byCategory: CategoryStatistics[] = [...categorySums.values()]
    .map(({ category, manual, sum }) => {
      const totals = sum.totals();
      return { category, manual, ...totals, net: manual ? null : totals.net };
    })
    .sort(
      (a, b) =>
        categoryRank(a) - categoryRank(b) || collator.compare(a.category ?? '', b.category ?? ''),
    );

  const captureCount = (sums: Map<number, Sum>, record: NamedRef): CaptureCount => {
    const sum = sums.get(record.id);
    return {
      id: record.id,
      name: record.name,
      lines: sum?.lines ?? 0,
      quantity: sum?.quantity ?? 0,
    };
  };
  const byEmployee = input.employees.map((e) => captureCount(employeeSums, e)).sort(byLines);
  const byWorkstation = [...workstationSums.keys()]
    .map((id) => captureCount(workstationSums, ref(workstationNames, id)))
    .sort(byLines);

  const overcounted: OvercountedArticle[] = [...articles.entries()]
    .flatMap(([articleId, article]) => {
      const expected = input.expectedQuantities.get(articleId);
      if (expected === undefined || article.quantity <= expected) return [];
      return [
        {
          articleId,
          description: article.entry.description,
          ean: article.entry.ean,
          expected,
          lines: article.lines,
          quantity: article.quantity,
          workAreas: [...article.workAreaIds].map((id) => ref(workAreaNames, id)).sort(byName),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.quantity - b.expected - (a.quantity - a.expected) ||
        collator.compare(a.description, b.description) ||
        a.articleId - b.articleId,
    );

  const manualTotals = manualSum.totals();
  return {
    stocktakeId: input.stocktakeId,
    progress,
    totals: total.totals(),
    byWorkArea,
    byCategory,
    byEmployee,
    byWorkstation,
    rate: captureRate(input.entries, input.until),
    manual: {
      lines: manualTotals.lines,
      quantity: manualTotals.quantity,
      gross: manualTotals.gross,
      entries: manualEntries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    },
    overcounted,
  };
}
