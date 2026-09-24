import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

describe('GET /api/health', async () => {
  const app = await buildApp({ version: '1.2.3' });
  afterAll(() => app.close());

  it('reports status and version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('responds with 404 without a frontend directory', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(404);
  });
});

describe('frontend delivery', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inventur-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<html>index</html>');
    await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1);');
    app = await buildApp({ version: 'test', staticDir: dir });
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves static files', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log(1);');
  });

  it.each(['/', '/admin', '/admin/mitarbeiter', '/scan'])(
    'serves index.html for %s',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<html>index</html>');
    },
  );

  it('responds with 404 instead of index.html for unknown API paths', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not found' });
  });
});
