import { normalizeName, type ErrorCode } from '@inventur/shared';
import { DomainError } from '../errors.ts';

/**
 * Rules for managing employees, work areas and workstations, independent of
 * the database.
 */

export interface NamedRecord {
  id: number;
  name: string;
}

export type Subject = 'Employee' | 'Work area' | 'Workstation';

export function parseName(value: string, subject: Subject): string {
  const name = normalizeName(value);
  if (name === null) {
    throw new DomainError('validation_failed', `${subject} name must not be empty or too long`);
  }
  return name;
}

/** Optional descriptions are trimmed; an empty description is stored as null. */
export function parseDescription(value: string | null | undefined): string | null {
  const description = value?.trim() ?? '';
  if (description.length > 500) {
    throw new DomainError('validation_failed', 'Description must not exceed 500 characters');
  }
  return description === '' ? null : description;
}

const nameKey = (name: string) => name.toLocaleLowerCase('de');

/**
 * Names are unique within their scope (a stocktake, or all workstations),
 * ignoring case. `exceptId` excludes the record that is being renamed.
 */
export function assertNameAvailable(
  name: string,
  existing: readonly NamedRecord[],
  subject: Subject,
  exceptId?: number,
): void {
  const key = nameKey(name);
  if (existing.some((record) => record.id !== exceptId && nameKey(record.name) === key)) {
    throw new DomainError('name_taken', `${subject} "${name}" already exists`);
  }
}

const HAS_ENTRIES: Record<Subject, ErrorCode> = {
  Employee: 'employee_has_entries',
  'Work area': 'work_area_has_entries',
  Workstation: 'workstation_has_entries',
};

/** Employees, work areas and workstations can only be deleted while they have no entries. */
export function assertDeletable(entryCount: number, subject: Subject): void {
  if (entryCount > 0) {
    throw new DomainError(
      HAS_ENTRIES[subject],
      `${subject} has ${entryCount} entries and cannot be deleted`,
    );
  }
}

/**
 * Selects the records of the previous stocktake to copy into the current one:
 * all whose name does not exist yet (ignoring case), in their original order.
 */
export function selectForImport<T extends { name: string }>(
  previous: readonly T[],
  existing: readonly { name: string }[],
): T[] {
  const taken = new Set(existing.map((record) => nameKey(record.name)));
  return previous.filter((record) => {
    const key = nameKey(record.name);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
}
