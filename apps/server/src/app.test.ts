import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('GET /api/health', async () => {
  const app = await buildApp({ version: '1.2.3' });
  afterAll(() => app.close());

  it('meldet den Status und die Version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });
});
