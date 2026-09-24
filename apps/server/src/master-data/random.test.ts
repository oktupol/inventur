import { describe, expect, it } from 'vitest';
import { Random } from './random.ts';

describe('Random', () => {
  it('yields the same sequence for the same seed', () => {
    const a = new Random(42);
    const b = new Random(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it('yields a different sequence for a different seed', () => {
    expect(new Random(1).next()).not.toBe(new Random(2).next());
  });

  it('stays within bounds', () => {
    const random = new Random(7);
    for (let i = 0; i < 1000; i++) {
      const n = random.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      expect([3, 4, 5]).toContain(random.int(3, 5));
    }
  });

  it('shuffles without losing items', () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(new Random(3).shuffle(items).sort()).toEqual(items);
  });
});
