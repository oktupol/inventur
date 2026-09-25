import { describe, expect, it } from 'vitest';
import { ean13, ean13CheckDigit, isValidEan13, hasValidEanCheckDigit } from './ean.ts';

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

describe('hasValidEanCheckDigit', () => {
  it('accepts EAN-13 and EAN-8 with a correct check digit', () => {
    expect(hasValidEanCheckDigit('4006381333931')).toBe(true);
    expect(hasValidEanCheckDigit('96385074')).toBe(true);
    expect(hasValidEanCheckDigit('40170725')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(hasValidEanCheckDigit('4006381333932')).toBe(false);
    expect(hasValidEanCheckDigit('96385075')).toBe(false);
  });

  it('rejects other lengths and characters', () => {
    expect(hasValidEanCheckDigit('123456789012')).toBe(false);
    expect(hasValidEanCheckDigit('40063813339X1')).toBe(false);
  });

  it('agrees with the EAN-13 check', () => {
    for (const code of ['4000000000017', '4000000000031', '4354287315668']) {
      expect(hasValidEanCheckDigit(code)).toBe(isValidEan13(code));
    }
  });
});
