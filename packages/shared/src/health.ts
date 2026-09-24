/** Antwort von `GET /api/health`. */
export interface HealthResponse {
  status: 'ok';
  version: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.status === 'ok' && typeof candidate.version === 'string';
}
