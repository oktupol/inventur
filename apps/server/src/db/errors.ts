/** Checks for a Postgres unique violation, optionally of a specific constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const pgError = error as { code?: unknown; constraint?: unknown };
  return (
    pgError.code === '23505' && (constraint === undefined || pgError.constraint === constraint)
  );
}
