import { describe, expect, it } from 'vitest';
import { parsePrice } from './entry.ts';

describe('parsePrice', () => {
  it.each([
    ['129,90', '129.90'],
    ['129,9', '129.90'],
    ['129', '129.00'],
    ['1.299,00', '1299.00'],
    ['1.299', '1299.00'],
    ['1.234.567,5', '1234567.50'],
    ['129.90', '129.90'],
    ['0,50', '0.50'],
    [' 12 € ', '12.00'],
    ['007', '7.00'],
  ])('%s → %s', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it.each(['', '0', '0,00', '-5', '12,345', 'abc', '1,2,3', '12.3.4', '12345678901'])(
    'rejects %j',
    (text) => {
      expect(parsePrice(text)).toBeNull();
    },
  );
});
