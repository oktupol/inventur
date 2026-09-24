import { describe, expect, it } from 'vitest';
import { ScanDebouncer } from './debounce.ts';

describe('ScanDebouncer', () => {
  it('accepts a new code', () => {
    expect(new ScanDebouncer().accept('4006381333931', 0)).toBe(true);
  });

  it('ignores the same code within two seconds', () => {
    const debouncer = new ScanDebouncer();
    debouncer.accept('A', 0);
    expect(debouncer.accept('A', 500)).toBe(false);
    expect(debouncer.accept('A', 1999 + 500)).toBe(false);
  });

  it('accepts the same code again after two seconds out of sight', () => {
    const debouncer = new ScanDebouncer();
    debouncer.accept('A', 0);
    expect(debouncer.accept('A', 2000)).toBe(true);
  });

  it('keeps ignoring a code that stays in view', () => {
    const debouncer = new ScanDebouncer();
    debouncer.accept('A', 0);
    for (let t = 150; t <= 6000; t += 150) expect(debouncer.accept('A', t)).toBe(false);
  });

  it('accepts another code right away, and the first one again afterwards', () => {
    const debouncer = new ScanDebouncer();
    debouncer.accept('A', 0);
    expect(debouncer.accept('B', 100)).toBe(true);
    expect(debouncer.accept('A', 200)).toBe(true);
  });
});
