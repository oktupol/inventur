import { describe, expect, it } from 'vitest';
import { isHealthResponse } from './health.ts';

describe('isHealthResponse', () => {
  it('accepts a valid response', () => {
    expect(isHealthResponse({ status: 'ok', version: '1.0.0' })).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isHealthResponse(null)).toBe(false);
    expect(isHealthResponse({ status: 'error', version: '1.0.0' })).toBe(false);
    expect(isHealthResponse({ status: 'ok' })).toBe(false);
  });
});
