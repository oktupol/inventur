import { DomainError } from '../errors.ts';

/**
 * Checkpoints of a work area, independent of the database. Times are
 * microseconds since the epoch, so lines and checkpoints within the same
 * millisecond are still ordered correctly.
 *
 * A checkpoint has a boundary: lines created until then lie before it. The
 * checkpoints are numbered 1, 2, 3 … in the order of their boundaries, and
 * every section before a checkpoint holds at least one line.
 */

export interface TimedEntry {
  id: number;
  /** Creation time in microseconds. */
  at: number;
  quantity: number;
}

export interface TimedCheckpoint {
  id: number;
  /** Boundary in microseconds. */
  at: number;
}

export interface CheckpointCount {
  id: number;
  /** Position in the list, starting at 1. */
  number: number;
  /** Lines in the section before the checkpoint. */
  lines: number;
  sinceLast: number;
  sinceStart: number;
}

export interface CheckpointCounting {
  /** Ordered by number. */
  checkpoints: CheckpointCount[];
  /** Pieces after the newest checkpoint; all pieces without a checkpoint. */
  sinceLastCheckpoint: number;
  total: number;
  /** For each line the number of the checkpoint closing its section, null after the newest. */
  sectionOf: Map<number, number | null>;
}

function ordered(checkpoints: readonly TimedCheckpoint[]): TimedCheckpoint[] {
  return [...checkpoints].sort((a, b) => a.at - b.at || a.id - b.id);
}

/**
 * Counts pieces per section. A line belongs to the section in which it was
 * created, so later changes and deletions change the counts of its section.
 */
export function countCheckpoints(
  entries: readonly TimedEntry[],
  checkpoints: readonly TimedCheckpoint[],
): CheckpointCounting {
  const sorted = ordered(checkpoints);
  const pieces = new Map<number | null, number>();
  const lines = new Map<number | null, number>();
  const sectionOf = new Map<number, number | null>();
  for (const entry of entries) {
    const index = sorted.findIndex((checkpoint) => entry.at <= checkpoint.at);
    const section = index === -1 ? null : index + 1;
    sectionOf.set(entry.id, section);
    pieces.set(section, (pieces.get(section) ?? 0) + entry.quantity);
    lines.set(section, (lines.get(section) ?? 0) + 1);
  }

  let sinceStart = 0;
  const counts = sorted.map(({ id }, index) => {
    const number = index + 1;
    const sinceLast = pieces.get(number) ?? 0;
    sinceStart += sinceLast;
    return { id, number, lines: lines.get(number) ?? 0, sinceLast, sinceStart };
  });
  const sinceLastCheckpoint = pieces.get(null) ?? 0;
  return {
    checkpoints: counts,
    sinceLastCheckpoint,
    total: sinceStart + sinceLastCheckpoint,
    sectionOf,
  };
}

/** Checkpoints whose section has no line, e.g. after its last line was deleted. */
export function emptyCheckpoints(
  entries: readonly TimedEntry[],
  checkpoints: readonly TimedCheckpoint[],
): CheckpointCount[] {
  return countCheckpoints(entries, checkpoints).checkpoints.filter((c) => c.lines === 0);
}

/**
 * Checks a new checkpoint at the boundary `at`: the section before it and,
 * if a later checkpoint exists, the section after it must each hold at least
 * one line. Returns the number the new checkpoint gets.
 */
export function planCheckpoint(
  entries: readonly TimedEntry[],
  checkpoints: readonly TimedCheckpoint[],
  at: number,
): number {
  const sorted = ordered(checkpoints);
  const index = sorted.findIndex((checkpoint) => at < checkpoint.at);
  const previous = index === -1 ? sorted.at(-1) : sorted[index - 1];
  const next = index === -1 ? undefined : sorted[index];
  const inRange = (from: number, to: number) => entries.some((e) => e.at > from && e.at <= to);
  const start = previous?.at ?? -Infinity;
  const sameBoundary = previous !== undefined && previous.at === at;
  if (sameBoundary || !inRange(start, at) || (next && !inRange(at, next.at))) {
    throw new DomainError(
      'checkpoint_empty_section',
      'Every section between checkpoints must contain at least one line',
    );
  }
  return (index === -1 ? sorted.length : index) + 1;
}
