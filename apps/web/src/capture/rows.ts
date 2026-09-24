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

/** Where a checkpoint can be inserted from the edges of a line; null where it is not possible. */
export interface InsertionTargets {
  /** Upper edge: the checkpoint follows this line (the list shows the newest line first). */
  top: number | null;
  /** Lower edge: the checkpoint follows the older line below this one. */
  bottom: number | null;
}

/**
 * A checkpoint can be inserted between two lines, or above the newest line.
 * Next to an existing checkpoint or below the oldest line it would leave a
 * section without lines, so no button is offered there.
 */
export function insertionTargets(rows: readonly ListRow[], index: number): InsertionTargets {
  const row = rows[index];
  if (row?.type !== 'entry') return { top: null, bottom: null };
  const above = rows[index - 1];
  const below = rows[index + 1];
  return {
    top: above === undefined || above.type === 'entry' ? row.entry.id : null,
    bottom: below?.type === 'entry' ? below.entry.id : null,
  };
}
