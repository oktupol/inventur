/**
 * Counting of checkpoints, independent of the database. Times are
 * microseconds since the epoch, so lines and checkpoints created within the
 * same millisecond are still ordered correctly.
 */

export interface TimedEntry {
  id: number;
  /** Creation time in microseconds. */
  at: number;
  quantity: number;
}

export interface TimedCheckpoint {
  id: number;
  number: number;
  /** Creation time in microseconds. */
  at: number;
}

export interface CheckpointCount {
  id: number;
  number: number;
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

/**
 * A line belongs to the section in which it was created: before the first
 * checkpoint created at or after it. Counts are sums of quantities, so later
 * changes and deletions of lines change the counts of their section.
 */
export function countCheckpoints(
  entries: readonly TimedEntry[],
  checkpoints: readonly TimedCheckpoint[],
): CheckpointCounting {
  const ordered = [...checkpoints].sort((a, b) => a.number - b.number);
  const sums = new Map<number | null, number>();
  const sectionOf = new Map<number, number | null>();
  for (const entry of entries) {
    const section = ordered.find((checkpoint) => entry.at <= checkpoint.at)?.number ?? null;
    sectionOf.set(entry.id, section);
    sums.set(section, (sums.get(section) ?? 0) + entry.quantity);
  }

  let sinceStart = 0;
  const counts = ordered.map(({ id, number }) => {
    const sinceLast = sums.get(number) ?? 0;
    sinceStart += sinceLast;
    return { id, number, sinceLast, sinceStart };
  });
  const sinceLastCheckpoint = sums.get(null) ?? 0;
  return {
    checkpoints: counts,
    sinceLastCheckpoint,
    total: sinceStart + sinceLastCheckpoint,
    sectionOf,
  };
}

/** The next consecutive checkpoint number of a work area. */
export function nextCheckpointNumber(existingNumbers: readonly number[]): number {
  return existingNumbers.reduce((max, n) => Math.max(max, n), 0) + 1;
}
