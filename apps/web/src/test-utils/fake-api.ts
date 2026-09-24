import { vi } from 'vitest';

export interface ApiCall {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (call: ApiCall) => { status?: number; body?: unknown } | undefined;

/**
 * Replaces `fetch` with a fake API. `handle` answers each request; returning
 * undefined responds with 404. All calls are recorded in `calls`.
 */
export function stubApi(handle: Handler) {
  const calls: ApiCall[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call: ApiCall = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const response = handle(call) ?? {
      status: 404,
      body: { error: 'Not found', code: 'not_found' },
    };
    const status = response.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(response.body ?? null), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}
