import { describe, expect, it } from 'vitest';
import { fromCents, lineCents, toCents } from './money.ts';

describe('money', () => {
  it('parses decimal strings into cents', () => {
    expect(toCents('119.00')).toBe(11900n);
    expect(toCents('11.9')).toBe(1190n);
    expect(toCents('7')).toBe(700n);
    expect(toCents('0.05')).toBe(5n);
    expect(toCents('-3.20')).toBe(-320n);
  });

  it('rejects invalid amounts', () => {
    expect(() => toCents('1,50')).toThrow();
    expect(() => toCents('1.505')).toThrow();
    expect(() => toCents('')).toThrow();
  });

  it('formats cents with two places', () => {
    expect(fromCents(11900n)).toBe('119.00');
    expect(fromCents(5n)).toBe('0.05');
    expect(fromCents(0n)).toBe('0.00');
    expect(fromCents(-320n)).toBe('-3.20');
  });

  it('multiplies prices exactly, also beyond the safe range of numbers', () => {
    expect(fromCents(lineCents('11.90', 3))).toBe('35.70');
    expect(fromCents(lineCents('0.10', 3))).toBe('0.30');
    expect(fromCents(lineCents('9999999999.99', 99_999))).toBe('999989999999000.01');
  });
});
