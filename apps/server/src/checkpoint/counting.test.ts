import { describe, expect, it } from 'vitest';
import {
  countCheckpoints,
  nextCheckpointNumber,
  type TimedCheckpoint,
  type TimedEntry,
} from './counting.ts';

const entry = (id: number, at: number, quantity = 1): TimedEntry => ({ id, at, quantity });
const checkpoint = (number: number, at: number): TimedCheckpoint => ({
  id: 100 + number,
  number,
  at,
});

describe('countCheckpoints', () => {
  it('counts everything as since the start without checkpoints', () => {
    const result = countCheckpoints([entry(1, 10), entry(2, 20, 3)], []);
    expect(result).toMatchObject({ checkpoints: [], sinceLastCheckpoint: 4, total: 4 });
    expect(result.sectionOf.get(1)).toBeNull();
  });

  it('counts pieces per section and since the start', () => {
    const entries = [entry(1, 10), entry(2, 20, 2), entry(3, 40, 5), entry(4, 60), entry(5, 70)];
    const result = countCheckpoints(entries, [checkpoint(1, 30), checkpoint(2, 50)]);
    expect(result.checkpoints).toEqual([
      { id: 101, number: 1, sinceLast: 3, sinceStart: 3 },
      { id: 102, number: 2, sinceLast: 5, sinceStart: 8 },
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

  it('counts empty sections as 0, e.g. two checkpoints in a row', () => {
    const result = countCheckpoints([entry(1, 10)], [checkpoint(1, 20), checkpoint(2, 30)]);
    expect(result.checkpoints.map((c) => [c.sinceLast, c.sinceStart])).toEqual([
      [1, 1],
      [0, 1],
    ]);
    expect(result.sinceLastCheckpoint).toBe(0);
  });

  it('assigns a line created at the same time as a checkpoint to the section before it', () => {
    const result = countCheckpoints([entry(1, 30)], [checkpoint(1, 30)]);
    expect(result.checkpoints[0]!.sinceLast).toBe(1);
  });

  it('keeps lines in their section when their quantity changes later', () => {
    const before = [entry(1, 10), entry(2, 40)];
    const checkpoints = [checkpoint(1, 30)];
    // Line 1 was changed after the checkpoint; it still belongs to the first section.
    const after = countCheckpoints([entry(1, 10, 20), entry(2, 40)], checkpoints);
    expect(countCheckpoints(before, checkpoints).checkpoints[0]!.sinceLast).toBe(1);
    expect(after.checkpoints[0]).toMatchObject({ sinceLast: 20, sinceStart: 20 });
    expect(after.sinceLastCheckpoint).toBe(1);
  });

  it('recounts when lines are deleted', () => {
    const checkpoints = [checkpoint(1, 30), checkpoint(2, 50)];
    const result = countCheckpoints([entry(2, 20), entry(3, 40)], checkpoints);
    expect(result.checkpoints.map((c) => [c.sinceLast, c.sinceStart])).toEqual([
      [1, 1],
      [1, 2],
    ]);
    const without = countCheckpoints([entry(3, 40)], checkpoints);
    expect(without.checkpoints.map((c) => [c.sinceLast, c.sinceStart])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('continues after closing and reopening: new lines count after the newest checkpoint', () => {
    // Checkpoint 1 at 30, area closed at 35 and reopened at 45, new line at 50.
    const result = countCheckpoints([entry(1, 10), entry(2, 50)], [checkpoint(1, 30)]);
    expect(result.checkpoints[0]).toMatchObject({ sinceLast: 1, sinceStart: 1 });
    expect(result.sinceLastCheckpoint).toBe(1);
    expect(result.total).toBe(2);
  });

  it('does not depend on the order of the input', () => {
    const entries = [entry(3, 40), entry(1, 10), entry(2, 20)];
    const result = countCheckpoints(entries, [checkpoint(2, 50), checkpoint(1, 15)]);
    expect(result.checkpoints.map((c) => c.sinceLast)).toEqual([1, 2]);
  });
});

describe('nextCheckpointNumber', () => {
  it('numbers checkpoints consecutively per work area', () => {
    expect(nextCheckpointNumber([])).toBe(1);
    expect(nextCheckpointNumber([1, 2, 3])).toBe(4);
  });
});
