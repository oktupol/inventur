import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import {
  countCheckpoints,
  emptyCheckpoints,
  planCheckpoint,
  type TimedCheckpoint,
  type TimedEntry,
} from './counting.ts';

const entry = (id: number, at: number, quantity = 1): TimedEntry => ({ id, at, quantity });
const checkpoint = (id: number, at: number): TimedCheckpoint => ({ id, at });

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('countCheckpoints', () => {
  it('counts everything as since the start without checkpoints', () => {
    const result = countCheckpoints([entry(1, 10), entry(2, 20, 3)], []);
    expect(result).toMatchObject({ checkpoints: [], sinceLastCheckpoint: 4, total: 4 });
    expect(result.sectionOf.get(1)).toBeNull();
  });

  it('counts pieces and lines per section and since the start', () => {
    const entries = [entry(1, 10), entry(2, 20, 2), entry(3, 40, 5), entry(4, 60), entry(5, 70)];
    const result = countCheckpoints(entries, [checkpoint(7, 30), checkpoint(8, 50)]);
    expect(result.checkpoints).toEqual([
      { id: 7, number: 1, lines: 2, sinceLast: 3, sinceStart: 3 },
      { id: 8, number: 2, lines: 1, sinceLast: 5, sinceStart: 8 },
    ]);
    expect(result.sinceLastCheckpoint).toBe(2);
    expect(result.total).toBe(10);
    expect([...result.sectionOf.entries()]).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, null],
      [5, null],
    ]);
  });

  it('numbers checkpoints by position, also when one was inserted later', () => {
    // Checkpoint 9 was created after checkpoint 7 but lies before it.
    const result = countCheckpoints(
      [entry(1, 10), entry(2, 20), entry(3, 40)],
      [checkpoint(7, 30), checkpoint(9, 15)],
    );
    expect(result.checkpoints.map((c) => [c.id, c.number, c.sinceLast])).toEqual([
      [9, 1, 1],
      [7, 2, 1],
    ]);
    expect(result.sectionOf.get(2)).toBe(2);
  });

  it('assigns a line created at the boundary to the section before it', () => {
    const result = countCheckpoints([entry(1, 30)], [checkpoint(1, 30)]);
    expect(result.checkpoints[0]!.sinceLast).toBe(1);
  });

  it('keeps lines in their section when their quantity changes later', () => {
    const result = countCheckpoints([entry(1, 10, 20), entry(2, 40)], [checkpoint(1, 30)]);
    expect(result.checkpoints[0]).toMatchObject({ sinceLast: 20, sinceStart: 20 });
    expect(result.sinceLastCheckpoint).toBe(1);
  });

  it('renumbers the later checkpoints when one is deleted', () => {
    const entries = [entry(1, 10), entry(2, 20), entry(3, 40)];
    const all = [checkpoint(1, 15), checkpoint(2, 25), checkpoint(3, 45)];
    const without = countCheckpoints(
      entries,
      all.filter((c) => c.id !== 1),
    );
    // The first two sections merge.
    expect(without.checkpoints.map((c) => [c.id, c.number, c.sinceLast])).toEqual([
      [2, 1, 2],
      [3, 2, 1],
    ]);
  });

  it('continues after closing and reopening: new lines count after the newest checkpoint', () => {
    const result = countCheckpoints([entry(1, 10), entry(2, 50)], [checkpoint(1, 30)]);
    expect(result.checkpoints[0]).toMatchObject({ sinceLast: 1, sinceStart: 1 });
    expect(result.sinceLastCheckpoint).toBe(1);
  });
});

describe('emptyCheckpoints', () => {
  const checkpoints = [checkpoint(1, 15), checkpoint(2, 25)];

  it('finds none while every section has a line', () => {
    expect(emptyCheckpoints([entry(1, 10), entry(2, 20)], checkpoints)).toEqual([]);
  });

  it('finds the checkpoint closing a section whose last line was deleted', () => {
    expect(emptyCheckpoints([entry(1, 10), entry(3, 30)], checkpoints).map((c) => c.id)).toEqual([
      2,
    ]);
  });

  it('finds the first checkpoint when the lines before it are gone', () => {
    expect(emptyCheckpoints([entry(2, 20)], checkpoints).map((c) => c.id)).toEqual([1]);
  });

  it('ignores an empty section after the newest checkpoint', () => {
    expect(emptyCheckpoints([entry(1, 10), entry(2, 20)], checkpoints)).toEqual([]);
  });
});

describe('planCheckpoint', () => {
  const entries = [entry(1, 10), entry(2, 20), entry(3, 30)];

  it('allows a checkpoint at the end after at least one new line', () => {
    expect(planCheckpoint(entries, [], 100)).toBe(1);
    expect(planCheckpoint(entries, [checkpoint(1, 15)], 100)).toBe(2);
  });

  it('rejects a checkpoint at the end without a line since the last one', () => {
    expect(codeOf(() => planCheckpoint(entries, [checkpoint(1, 30)], 100))).toBe(
      'checkpoint_empty_section',
    );
    expect(codeOf(() => planCheckpoint([], [], 100))).toBe('checkpoint_empty_section');
  });

  it('inserts a checkpoint after a line between two others and returns its number', () => {
    // After line 1, before the existing checkpoint after line 3.
    expect(planCheckpoint(entries, [checkpoint(1, 30)], 10)).toBe(1);
    expect(planCheckpoint(entries, [checkpoint(1, 10)], 20)).toBe(2);
  });

  it('rejects an insertion that would leave the following section empty', () => {
    // The new checkpoint would lie on the boundary of the existing one after line 3.
    expect(codeOf(() => planCheckpoint(entries, [checkpoint(1, 30)], 30))).toBe(
      'checkpoint_empty_section',
    );
    // Between the checkpoints after line 2 and after line 3 only line 3 lies.
    expect(codeOf(() => planCheckpoint(entries, [checkpoint(1, 20), checkpoint(2, 30)], 30))).toBe(
      'checkpoint_empty_section',
    );
  });

  it('rejects a checkpoint at the boundary of an existing one', () => {
    expect(codeOf(() => planCheckpoint(entries, [checkpoint(1, 20)], 20))).toBe(
      'checkpoint_empty_section',
    );
  });
});
