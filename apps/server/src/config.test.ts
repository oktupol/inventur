import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('verwendet Standardwerte', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      version: 'dev',
      staticDir: undefined,
    });
  });

  it('liest die Umgebungsvariablen', () => {
    expect(
      loadConfig({ HOST: '127.0.0.1', PORT: '8000', APP_VERSION: '1.0.0', STATIC_DIR: '/web' }),
    ).toEqual({ host: '127.0.0.1', port: 8000, version: '1.0.0', staticDir: '/web' });
  });

  it('lehnt einen ungültigen Port ab', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow('Ungültiger PORT');
  });
});
