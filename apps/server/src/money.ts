/**
 * Exact arithmetic for EUR amounts. The database and the API use decimal
 * strings with two places, sums are calculated in integer cents.
 */

const AMOUNT = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(amount: string): bigint {
  const match = AMOUNT.exec(amount);
  if (!match) throw new Error(`Invalid amount: ${amount}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

/** Formats cents as a decimal string with two places, e.g. 12345n as "123.45". */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/** Price × quantity in cents. */
export function lineCents(price: string, quantity: number): bigint {
  return toCents(price) * BigInt(quantity);
}
