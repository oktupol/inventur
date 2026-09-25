import { MAX_QUANTITY, parsePrice, type Article, type WorkAreaStatus } from '@inventur/shared';
import { DomainError } from '../errors.ts';
import { acceptsEntries } from '../work-area/status.ts';

/** Rules for capturing entries, independent of the database. */

export interface CaptureContext {
  workArea: { status: WorkAreaStatus } | null;
  employeeCount: number;
}

/**
 * A workstation can only capture while it works in a work area that is not
 * closed and at least one employee is logged in to it.
 */
export function assertCanCapture({ workArea, employeeCount }: CaptureContext): void {
  if (!workArea) throw new DomainError('no_work_area', 'Workstation is not in a work area');
  if (!acceptsEntries(workArea.status)) {
    throw new DomainError('work_area_closed', 'Work area is closed');
  }
  if (employeeCount === 0) {
    throw new DomainError('no_employee_logged_in', 'No employee is logged in to the workstation');
  }
}

export function parseInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed.length > 200) {
    throw new DomainError('validation_failed', 'Input must not be empty or too long');
  }
  return trimmed;
}

/** The master data stored with an entry, so the result stays stable when master data changes. */
export function snapshotOf(article: Article) {
  return {
    article_id: article.id,
    is_manual: false,
    description: article.description,
    ean: article.ean,
    category: article.category,
    price_net: article.priceNet,
    price_gross: article.priceGross,
  };
}

/**
 * The quantity after a change: an absolute value must be between 1 and the
 * maximum; a relative change stops at 1 (decrementing 1 changes nothing).
 */
export function nextQuantity(
  current: number,
  change: { quantity: number } | { delta: number },
): number {
  if ('quantity' in change) {
    if (
      !Number.isInteger(change.quantity) ||
      change.quantity < 1 ||
      change.quantity > MAX_QUANTITY
    ) {
      throw new DomainError('validation_failed', `Quantity must be between 1 and ${MAX_QUANTITY}`);
    }
    return change.quantity;
  }
  return Math.min(MAX_QUANTITY, Math.max(1, current + change.delta));
}

/** Longest serial number of a line. */
export const MAX_SERIAL_NUMBER_LENGTH = 100;

/**
 * A serial number as stored: trimmed, and null when empty. Serial numbers
 * need not be unique.
 */
export function parseSerialNumber(value: string | null | undefined): string | null {
  const serialNumber = value?.trim() || null;
  if (serialNumber && serialNumber.length > MAX_SERIAL_NUMBER_LENGTH) {
    throw new DomainError('validation_failed', 'Serial number is too long');
  }
  return serialNumber;
}

export interface ManualEntryInput {
  input: string;
  description: string;
  priceGross: string;
  serialNumber?: string | null;
}

/**
 * Validates a manually captured article: description and a gross price
 * greater than 0 are required, the serial number is optional. Net price and
 * category stay empty.
 */
export function manualEntryValues(request: ManualEntryInput) {
  const description = request.description.trim().replace(/\s+/g, ' ');
  if (description === '' || description.length > 200) {
    throw new DomainError('validation_failed', 'Description must not be empty or too long');
  }
  const priceGross = parsePrice(request.priceGross);
  if (priceGross === null) {
    throw new DomainError('validation_failed', 'Gross price must be a positive amount');
  }
  const serialNumber = parseSerialNumber(request.serialNumber);
  const input = request.input.trim();
  if (input.length > 200) throw new DomainError('validation_failed', 'Input is too long');
  return {
    article_id: null,
    is_manual: true,
    input,
    description,
    ean: null,
    category: null,
    price_net: null,
    price_gross: priceGross,
    serial_number: serialNumber,
  };
}

/**
 * Time in which the server accepts restoring a deleted line. It is longer
 * than the undo offer at the workstation, so that a request delayed by a
 * lost connection still succeeds.
 */
export const RESTORE_WINDOW_MS = 60_000;

/** The newest deletion or restoration of a workstation, from the audit log. */
export interface LastRemoval {
  action: 'deleted' | 'restored';
  entryId: number | null;
  createdAt: Date;
}

/**
 * Decides whether a workstation may restore a line: only the line it
 * deleted last, and only shortly after. Restoring the same line again (a
 * repeated request) is answered with the line restored before.
 */
export function planRestore(
  last: LastRemoval | undefined,
  entryId: number,
  now: Date,
): 'restore' | 'already_restored' {
  if (last?.entryId === entryId && last.action === 'restored') return 'already_restored';
  if (last?.entryId !== entryId || now.getTime() - last.createdAt.getTime() > RESTORE_WINDOW_MS) {
    throw new DomainError(
      'restore_unavailable',
      'Only the line deleted last by this workstation can be restored, shortly after deleting it',
    );
  }
  return 'restore';
}
