import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import { checkRedeemable, deviceLabel, generateCode, normalizeCode } from './rules.ts';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('generateCode', () => {
  it('creates six digits with leading zeros', () => {
    expect(generateCode(() => 42)).toBe('000042');
    expect(generateCode(() => 999_999)).toBe('999999');
  });
});

describe('normalizeCode', () => {
  it('accepts six digits, also with spaces', () => {
    expect(normalizeCode(' 123 456 ')).toBe('123456');
  });

  it.each(['12345', '1234567', '12a456', ''])('rejects %j', (input) => {
    expect(codeOf(() => normalizeCode(input))).toBe('validation_failed');
  });
});

describe('checkRedeemable', () => {
  const created = new Date('2026-01-01T10:00:00Z');
  const validUntil = new Date(created.getTime() + 5 * 60 * 1000);
  const at = (minutes: number) => new Date(created.getTime() + minutes * 60 * 1000);

  it('accepts an unused code within five minutes', () => {
    expect(codeOf(() => checkRedeemable({ validUntil, pairedAt: null }, at(0)))).toBeUndefined();
    expect(codeOf(() => checkRedeemable({ validUntil, pairedAt: null }, at(5)))).toBeUndefined();
  });

  it('rejects an expired code', () => {
    expect(codeOf(() => checkRedeemable({ validUntil, pairedAt: null }, at(5.01)))).toBe(
      'pairing_expired',
    );
  });

  it('accepts a code only once', () => {
    expect(codeOf(() => checkRedeemable({ validUntil, pairedAt: at(1) }, at(2)))).toBe(
      'pairing_used',
    );
  });

  it('reports a used code as used even after it expired', () => {
    expect(codeOf(() => checkRedeemable({ validUntil, pairedAt: at(1) }, at(10)))).toBe(
      'pairing_used',
    );
  });

  it('rejects unknown codes', () => {
    expect(codeOf(() => checkRedeemable(undefined, at(0)))).toBe('pairing_invalid');
  });
});

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)', 'iPad'],
    [
      'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/126 Mobile Safari',
      'Android-Handy',
    ],
    ['Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/126 Safari', 'Android-Tablet'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'Gerät'],
    [undefined, 'Gerät'],
  ])('%s → %s', (agent, label) => {
    expect(deviceLabel(agent)).toBe(label);
  });
});
