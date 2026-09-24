import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      version: 'dev',
      staticDir: undefined,
      databaseUrl: undefined,
    });
  });

  it('reads the environment', () => {
    expect(
      loadConfig({
        HOST: '127.0.0.1',
        PORT: '8000',
        APP_VERSION: '1.0.0',
        STATIC_DIR: '/web',
        DATABASE_URL: 'postgres://db/inventur',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 8000,
      version: '1.0.0',
      staticDir: '/web',
      databaseUrl: 'postgres://db/inventur',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow('Invalid PORT');
  });
});
