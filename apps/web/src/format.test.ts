import { describe, expect, it } from 'vitest';
import { formatEuro, formatNumber } from './format.ts';

describe('formatting', () => {
  it('formats amounts in euro with German separators', () => {
    expect(formatEuro('1234.5').replace(/\s/g, ' ')).toBe('1.234,50 €');
    expect(formatEuro('0').replace(/\s/g, ' ')).toBe('0,00 €');
  });

  it('formats numbers with thousands separators', () => {
    expect(formatNumber(12345)).toBe('12.345');
  });
});
