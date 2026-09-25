import type { WorkAreaStatus } from '@inventur/shared';
import { countCheckpoints } from '../checkpoint/counting.ts';
import { fromCents, lineCents, toCents } from '../money.ts';

/**
 * The content of a count list, independent of the database and the PDF:
 * the lines of a work area in the order they were captured, with the
 * checkpoints as subtotals.
 */

export interface CountListLine {
  id: number;
  /** Creation time in microseconds, to place the line relative to the checkpoints. */
  at: number;
  createdAt: Date;
  description: string;
  ean: string | null;
  /** The scanned or typed input, shown when the line has no EAN. */
  input: string;
  serialNumber: string | null;
  quantity: number;
  priceNet: string | null;
  priceGross: string;
  isManual: boolean;
  workstation: string;
}

export interface CountListCheckpoint {
  id: number;
  /** Boundary in microseconds. */
  at: number;
  createdAt: Date;
  workstation: string | null;
}

export interface CountListTotals {
  lines: number;
  quantity: number;
  /** Manual articles have no net price and are not included. */
  net: string;
  gross: string;
}

export interface CountListPosition extends CountListLine {
  /** Position in the list, starting at 1. */
  position: number;
}

export interface CountListSection {
  positions: CountListPosition[];
  /** The checkpoint closing the section; null for the lines after the newest checkpoint. */
  checkpoint: {
    number: number;
    createdAt: Date;
    workstation: string | null;
    section: CountListTotals;
    sinceStart: CountListTotals;
  } | null;
}

export interface WorkAreaCountList {
  name: string;
  description: string | null;
  status: WorkAreaStatus;
  /** Employees logged in when the lines were captured, by name. */
  employees: string[];
  /** Time of the first and the last line; null without lines. */
  period: { from: Date; to: Date } | null;
  sections: CountListSection[];
  totals: CountListTotals;
}

export interface WorkAreaInput {
  name: string;
  description: string | null;
  status: WorkAreaStatus;
  employees: readonly string[];
  lines: readonly CountListLine[];
  checkpoints: readonly CountListCheckpoint[];
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

class Sum {
  lines = 0;
  quantity = 0;
  net = 0n;
  gross = 0n;

  add(line: CountListLine): void {
    this.lines += 1;
    this.quantity += line.quantity;
    if (line.priceNet !== null) this.net += lineCents(line.priceNet, line.quantity);
    this.gross += lineCents(line.priceGross, line.quantity);
  }

  plus(other: Sum): Sum {
    const sum = new Sum();
    sum.lines = this.lines + other.lines;
    sum.quantity = this.quantity + other.quantity;
    sum.net = this.net + other.net;
    sum.gross = this.gross + other.gross;
    return sum;
  }

  totals(): CountListTotals {
    return {
      lines: this.lines,
      quantity: this.quantity,
      net: fromCents(this.net),
      gross: fromCents(this.gross),
    };
  }
}

export function buildWorkAreaCountList(input: WorkAreaInput): WorkAreaCountList {
  const lines = [...input.lines].sort((a, b) => a.at - b.at || a.id - b.id);
  const counting = countCheckpoints(lines, input.checkpoints);
  const checkpoints = [...input.checkpoints].sort((a, b) => a.at - b.at || a.id - b.id);

  // Section n ends with checkpoint n; the lines after the newest one come last.
  const sections = new Map<number | null, CountListPosition[]>();
  lines.forEach((line, index) => {
    const section = counting.sectionOf.get(line.id) ?? null;
    const positions = sections.get(section) ?? [];
    positions.push({ ...line, position: index + 1 });
    sections.set(section, positions);
  });

  let sinceStart = new Sum();
  const result: CountListSection[] = checkpoints.map((checkpoint, index) => {
    const positions = sections.get(index + 1) ?? [];
    const section = new Sum();
    for (const position of positions) section.add(position);
    sinceStart = sinceStart.plus(section);
    return {
      positions,
      checkpoint: {
        number: index + 1,
        createdAt: checkpoint.createdAt,
        workstation: checkpoint.workstation,
        section: section.totals(),
        sinceStart: sinceStart.totals(),
      },
    };
  });
  const rest = sections.get(null);
  if (rest) result.push({ positions: rest, checkpoint: null });

  const total = new Sum();
  for (const line of lines) total.add(line);
  return {
    name: input.name,
    description: input.description,
    status: input.status,
    employees: [...new Set(input.employees)].sort(collator.compare),
    period: lines.length === 0 ? null : { from: lines[0]!.createdAt, to: lines.at(-1)!.createdAt },
    sections: result,
    totals: total.totals(),
  };
}

/** Totals over several work areas, e.g. for the count list of the whole stocktake. */
export function sumCountLists(areas: readonly WorkAreaCountList[]): CountListTotals {
  let lines = 0;
  let quantity = 0;
  let net = 0n;
  let gross = 0n;
  for (const area of areas) {
    lines += area.totals.lines;
    quantity += area.totals.quantity;
    net += toCents(area.totals.net);
    gross += toCents(area.totals.gross);
  }
  return { lines, quantity, net: fromCents(net), gross: fromCents(gross) };
}
