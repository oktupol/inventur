import { MAX_QUANTITY, type Article, type WorkAreaStatus } from '@inventur/shared';
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
