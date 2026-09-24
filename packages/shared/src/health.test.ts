import { describe, expect, it } from 'vitest';
import { isHealthResponse } from './health.ts';

describe('isHealthResponse', () => {
  it('erkennt eine gültige Antwort', () => {
    expect(isHealthResponse({ status: 'ok', version: '1.0.0' })).toBe(true);
  });

  it('lehnt ungültige Werte ab', () => {
    expect(isHealthResponse(null)).toBe(false);
    expect(isHealthResponse({ status: 'fehler', version: '1.0.0' })).toBe(false);
    expect(isHealthResponse({ status: 'ok' })).toBe(false);
  });
});
