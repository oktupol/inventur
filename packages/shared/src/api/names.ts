/** Maximum length of names of stocktakes, employees, work areas and workstations. */
export const MAX_NAME_LENGTH = 100;

/**
 * Normalizes a user-entered name: trims it and collapses inner whitespace.
 * Returns null if the name is empty or too long.
 */
export function normalizeName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}
