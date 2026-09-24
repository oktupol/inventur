import { isApiError, type ErrorCode } from '@inventur/shared';
import { errorMessage } from './messages.ts';

/** A failed API request. `message` is a German text for the user. */
export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'network_error';
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode | 'network_error', status: number, details?: unknown) {
    super(errorMessage(code));
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type Headers = Record<string, string>;

export async function apiRequest<T>(
  method: Method,
  url: string,
  body?: unknown,
  headers: Headers = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('network_error', 0);
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (isApiError(data)) throw new ApiRequestError(data.code, response.status, data.details);
    throw new ApiRequestError('internal_error', response.status);
  }
  return data as T;
}

/** API requests, optionally with extra headers such as the workstation token. */
export function createApi(headers: Headers = {}) {
  return {
    get: <T>(url: string) => apiRequest<T>('GET', url, undefined, headers),
    post: <T>(url: string, body?: unknown) => apiRequest<T>('POST', url, body ?? {}, headers),
    patch: <T>(url: string, body: unknown) => apiRequest<T>('PATCH', url, body, headers),
    delete: <T = void>(url: string) => apiRequest<T>('DELETE', url, undefined, headers),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api = createApi();
