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

export async function apiRequest<T>(method: Method, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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

export const api = {
  get: <T>(url: string) => apiRequest<T>('GET', url),
  post: <T>(url: string, body?: unknown) => apiRequest<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => apiRequest<T>('PATCH', url, body),
  delete: (url: string) => apiRequest<void>('DELETE', url),
};
