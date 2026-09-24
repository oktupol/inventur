import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

describe('GET /api/health', async () => {
  const app = await buildApp({ version: '1.2.3' });
  afterAll(() => app.close());

  it('meldet den Status und die Version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('antwortet ohne Frontend-Verzeichnis mit 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(404);
  });
});

describe('Auslieferung des Frontends', () => {
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

  it('liefert statische Dateien aus', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log(1);');
  });

  it.each(['/', '/admin', '/admin/mitarbeiter', '/scan'])(
    'liefert für %s die index.html',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<html>index</html>');
    },
  );

  it('liefert für unbekannte API-Pfade 404 statt index.html', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ fehler: 'Nicht gefunden' });
  });
});
