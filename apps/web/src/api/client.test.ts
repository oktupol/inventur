import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubApi } from '../test-utils/fake-api.ts';
import { api, ApiRequestError } from './client.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends JSON and returns the response body', async () => {
    const { calls } = stubApi(() => ({ status: 201, body: { id: 1 } }));
    expect(await api.post('/api/x', { name: 'A' })).toEqual({ id: 1 });
    expect(calls).toEqual([{ method: 'POST', url: '/api/x', body: { name: 'A' } }]);
  });

  it('returns undefined for 204 responses', async () => {
    stubApi(() => ({ status: 204 }));
    expect(await api.delete('/api/x/1')).toBeUndefined();
  });

  it('turns error responses into errors with a German message', async () => {
    stubApi(() => ({
      status: 409,
      body: { error: 'x', code: 'unclosed_work_areas', details: { workAreas: [] } },
    }));
    const error = await api.post('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: 'unclosed_work_areas',
      status: 409,
      details: { workAreas: [] },
      message: 'Es sind noch nicht alle Arbeitsbereiche abgeschlossen.',
    });
  });

  it('reports unknown error bodies as server errors', async () => {
    stubApi(() => ({ status: 502, body: 'Bad Gateway' }));
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'internal_error', status: 502 });
  });

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.get('/api/x')).rejects.toMatchObject({
      code: 'network_error',
      message: 'Der Server ist nicht erreichbar.',
    });
  });
});
