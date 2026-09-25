import type { Reconciliation, SurplusKind } from '@inventur/shared';
import { fromCents, lineCents, toCents } from '../money.ts';

/**
 * Export tables, independent of the file format and the database. Amounts
 * are decimal strings in EUR, the formats render them as numbers.
 */

export type ColumnType = 'text' | 'integer' | 'amount' | 'datetime';

export interface Column {
  header: string;
  type: ColumnType;
}

export type Cell = string | number | Date | null;

export interface Table {
  columns: Column[];
  rows: Cell[][];
}

/** A line with everything the exports show. */
export interface ExportEntry {
  id: number;
  workArea: string;
  articleId: number | null;
  isManual: boolean;
  description: string;
  ean: string | null;
  /** Current article numbers of the article in the master data. */
  articleNumbers: readonly string[];
  category: string | null;
  serialNumber: string | null;
  quantity: number;
  priceNet: string | null;
  priceGross: string;
  workstation: string;
  employees: readonly string[];
  createdAt: Date;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const text = (header: string): Column => ({ header, type: 'text' });
const integer = (header: string): Column => ({ header, type: 'integer' });
const amount = (header: string): Column => ({ header, type: 'amount' });

function yesNo(value: boolean): string {
  return value ? 'ja' : 'nein';
}

function joined(values: Iterable<string>): string {
  return [...new Set(values)].sort(collator.compare).join(', ');
}

function lineNet(entry: ExportEntry): string | null {
  return entry.priceNet === null ? null : fromCents(lineCents(entry.priceNet, entry.quantity));
}

/** One row per line, by work area and time. */
export function entryTable(entries: readonly ExportEntry[]): Table {
  const sorted = [...entries].sort(
    (a, b) =>
      collator.compare(a.workArea, b.workArea) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id - b.id,
  );
  return {
    columns: [
      text('Arbeitsbereich'),
      text('Bezeichnung'),
      text('EAN'),
      text('Artikelnummer(n)'),
      text('Kategorie'),
      text('Seriennummer'),
      integer('Menge'),
      amount('Preis netto'),
      amount('Preis brutto'),
      amount('Summe netto'),
      amount('Summe brutto'),
      text('manuell'),
      text('Station'),
      text('Mitarbeiter'),
      { header: 'Zeitpunkt', type: 'datetime' },
    ],
    rows: sorted.map((entry) => [
      entry.workArea,
      entry.description,
      entry.ean,
      entry.articleNumbers.join(', '),
      entry.category,
      entry.serialNumber,
      entry.quantity,
      entry.priceNet,
      entry.priceGross,
      lineNet(entry),
      fromCents(lineCents(entry.priceGross, entry.quantity)),
      yesNo(entry.isManual),
      entry.workstation,
      joined(entry.employees),
      entry.createdAt,
    ]),
  };
}

/**
 * One row per article with the sum of its lines. Manual lines have no
 * article, so each of them stays a row of its own. Prices are those of the
 * newest line; the sums add up every line with its own snapshot.
 */
export function articleTable(entries: readonly ExportEntry[]): Table {
  const groups = new Map<string, ExportEntry[]>();
  for (const entry of entries) {
    const key =
      entry.isManual || entry.articleId === null
        ? `entry:${entry.id}`
        : `article:${entry.articleId}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const rows = [...groups.values()].map((lines) => {
    const newest = lines.reduce((a, b) =>
      b.createdAt.getTime() > a.createdAt.getTime() ||
      (b.createdAt.getTime() === a.createdAt.getTime() && b.id > a.id)
        ? b
        : a,
    );
    let quantity = 0;
    let net = 0n;
    let gross = 0n;
    for (const line of lines) {
      quantity += line.quantity;
      if (line.priceNet !== null) net += lineCents(line.priceNet, line.quantity);
      gross += lineCents(line.priceGross, line.quantity);
    }
    return {
      newest,
      row: [
        joined(lines.map((line) => line.workArea)),
        newest.description,
        newest.ean,
        newest.articleNumbers.join(', '),
        newest.category,
        joined(lines.flatMap((line) => (line.serialNumber ? [line.serialNumber] : []))),
        lines.length,
        quantity,
        newest.priceNet,
        newest.priceGross,
        newest.isManual ? null : fromCents(net),
        fromCents(gross),
        yesNo(newest.isManual),
        joined(lines.map((line) => line.workstation)),
        joined(lines.flatMap((line) => line.employees)),
        newest.createdAt,
      ] satisfies Cell[],
    };
  });
  rows.sort(
    (a, b) =>
      collator.compare(a.newest.description, b.newest.description) ||
      Number(a.newest.isManual) - Number(b.newest.isManual) ||
      (a.newest.articleId ?? 0) - (b.newest.articleId ?? 0) ||
      a.newest.id - b.newest.id,
  );

  return {
    columns: [
      text('Arbeitsbereich'),
      text('Bezeichnung'),
      text('EAN'),
      text('Artikelnummer(n)'),
      text('Kategorie'),
      text('Seriennummer'),
      integer('Zeilen'),
      integer('Menge'),
      amount('Preis netto'),
      amount('Preis brutto'),
      amount('Summe netto'),
      amount('Summe brutto'),
      text('manuell'),
      text('Station'),
      text('Mitarbeiter'),
      { header: 'Zeitpunkt (letzte Erfassung)', type: 'datetime' },
    ],
    rows: rows.map(({ row }) => row),
  };
}

const SURPLUS_REASONS: Record<SurplusKind, string> = {
  excess: 'mehrfach gezählt',
  unknown: 'nicht mehr in den Stammdaten',
  manual: 'manuell erfasst',
};

function negate(value: string): string {
  return fromCents(-toCents(value));
}

/**
 * The shortage and the surplus of the target/actual comparison. Differences
 * and values are signed: negative for the shortage, positive for the surplus.
 */
export function reconciliationTable(
  reconciliation: Reconciliation,
  articleNumbers: ReadonlyMap<number, readonly string[]>,
): Table {
  const numbers = (articleId: number | null) =>
    articleId === null ? '' : (articleNumbers.get(articleId) ?? []).join(', ');
  return {
    columns: [
      text('Ergebnis'),
      text('Grund'),
      text('Bezeichnung'),
      text('EAN'),
      text('Artikelnummer(n)'),
      text('Kategorie'),
      integer('Soll'),
      integer('Ist'),
      integer('Differenz'),
      amount('Preis netto'),
      amount('Preis brutto'),
      amount('Wert netto'),
      amount('Wert brutto'),
    ],
    rows: [
      ...reconciliation.shortage.articles.map((article): Cell[] => [
        'Fehlbestand',
        'nicht erfasst',
        article.description,
        article.ean,
        numbers(article.articleId),
        article.category,
        1,
        0,
        -1,
        article.priceNet,
        article.priceGross,
        negate(article.priceNet),
        negate(article.priceGross),
      ]),
      ...reconciliation.surplus.items.map((item): Cell[] => [
        'Mehrbestand',
        SURPLUS_REASONS[item.kind],
        item.description,
        item.ean,
        numbers(item.articleId),
        item.category,
        item.expected,
        item.counted,
        item.surplus,
        item.priceNet,
        item.priceGross,
        item.net,
        item.gross,
      ]),
    ],
  };
}
