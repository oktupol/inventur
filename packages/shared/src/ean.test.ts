import { describe, expect, it } from 'vitest';
import { ean13, ean13CheckDigit, isValidEan13 } from './ean.ts';

describe('EAN-13', () => {
  it.each([
    ['400638133393', 1],
    ['501234567890', 0],
    ['978316148410', 0],
  ])('computes the check digit of %s', (base, checkDigit) => {
    expect(ean13CheckDigit(base)).toBe(checkDigit);
  });

  it('appends the check digit', () => {
    expect(ean13('400638133393')).toBe('4006381333931');
  });

  it('tells valid from invalid codes', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('400638133393a')).toBe(false);
  });

  it('rejects a wrong length', () => {
    expect(() => ean13CheckDigit('123')).toThrow();
  });
});
