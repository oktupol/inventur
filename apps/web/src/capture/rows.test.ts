import type { Checkpoint, Entry } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { buildRows, insertionTargets, type ListRow } from './rows.ts';

const entry = (id: number, checkpointNumber: number | null) => ({ id, checkpointNumber }) as Entry;
const checkpoint = (number: number) => ({ id: 100 + number, number }) as Checkpoint;

const describeRows = (rows: ListRow[]) =>
  rows.map((row) =>
    row.type === 'entry'
      ? `e${row.entry.id}`
      : row.type === 'since'
        ? `since${row.number}:${row.quantity}`
        : `cp${row.checkpoint.number}`,
  );

describe('buildRows', () => {
  it('lists only lines without checkpoints', () => {
    expect(describeRows(buildRows([entry(2, null), entry(1, null)], [], 2))).toEqual(['e2', 'e1']);
  });

  it('places separators between sections and the live counter above the newest checkpoint', () => {
    const entries = [entry(5, null), entry(4, 2), entry(3, 2), entry(2, 1), entry(1, 1)];
    const rows = buildRows(entries, [checkpoint(2), checkpoint(1)], 1);
    expect(describeRows(rows)).toEqual(['e5', 'since2:1', 'cp2', 'e4', 'e3', 'cp1', 'e2', 'e1']);
  });

  it('shows checkpoints without lines in their section', () => {
    const rows = buildRows([entry(1, 1)], [checkpoint(1), checkpoint(2)], 0);
    expect(describeRows(rows)).toEqual(['since2:0', 'cp2', 'cp1', 'e1']);
  });
});

describe('insertionTargets', () => {
  // e5 | since | cp2 | e4 e3 | cp1 | e2 e1
  const rows = buildRows(
    [entry(5, null), entry(4, 2), entry(3, 2), entry(2, 1), entry(1, 1)],
    [checkpoint(2), checkpoint(1)],
    1,
  );
  const at = (id: number) =>
    insertionTargets(
      rows,
      rows.findIndex((r) => r.type === 'entry' && r.entry.id === id),
    );

  it('inserts after the line itself at the upper edge and after the line below at the lower edge', () => {
    expect(at(4)).toEqual({ top: null, bottom: 3 });
    expect(at(3)).toEqual({ top: 3, bottom: null });
    expect(at(2)).toEqual({ top: null, bottom: 1 });
  });

  it('allows the upper edge of the newest line', () => {
    expect(at(5)).toEqual({ top: 5, bottom: null });
  });

  it('offers nothing below the oldest line', () => {
    expect(at(1)).toEqual({ top: 1, bottom: null });
  });

  it('offers nothing for separator rows', () => {
    expect(insertionTargets(rows, 1)).toEqual({ top: null, bottom: null });
  });
});
