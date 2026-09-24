import type { Checkpoint, Entry } from '@inventur/shared';

export type ListRow =
  | { type: 'entry'; entry: Entry }
  | { type: 'since'; number: number; quantity: number }
  | { type: 'checkpoint'; checkpoint: Checkpoint };

/**
 * Rows of the entry list, newest first: the lines after the newest
 * checkpoint, a live counter since that checkpoint, then each checkpoint as
 * a separator followed by the lines of its section.
 */
export function buildRows(
  entries: readonly Entry[],
  checkpoints: readonly Checkpoint[],
  sinceLastCheckpoint: number,
): ListRow[] {
  const inSection = (number: number | null): ListRow[] =>
    entries
      .filter((entry) => entry.checkpointNumber === number)
      .map((entry) => ({ type: 'entry', entry }));
  const newestFirst = [...checkpoints].sort((a, b) => b.number - a.number);
  const rows = inSection(null);
  if (newestFirst.length > 0) {
    rows.push({ type: 'since', number: newestFirst[0]!.number, quantity: sinceLastCheckpoint });
  }
  for (const checkpoint of newestFirst) {
    rows.push({ type: 'checkpoint', checkpoint }, ...inSection(checkpoint.number));
  }
  return rows;
}
