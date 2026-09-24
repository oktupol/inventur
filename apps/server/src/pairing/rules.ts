import { DomainError } from '../errors.ts';

/**
 * Rules for pairing phones with workstations, independent of the database:
 * a code or QR token is valid for five minutes and can be used once.
 */

/** Six random digits; `randomInt` returns an integer in [0, max). */
export function generateCode(randomInt: (max: number) => number): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

/** Accepts codes typed with spaces, e.g. "123 456". */
export function normalizeCode(input: string): string {
  const code = input.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    throw new DomainError('validation_failed', 'The code must consist of six digits');
  }
  return code;
}

export interface PairingState {
  validUntil: Date;
  pairedAt: Date | null;
}

/** Checks that a pairing offer exists, is still valid and was not used yet. */
export function checkRedeemable(pairing: PairingState | undefined, now: Date): void {
  if (!pairing) throw new DomainError('pairing_invalid', 'Unknown pairing code');
  if (pairing.pairedAt !== null) {
    throw new DomainError('pairing_used', 'The pairing code was already used');
  }
  if (now.getTime() > pairing.validUntil.getTime()) {
    throw new DomainError('pairing_expired', 'The pairing code has expired');
  }
}

/** A short German name for the kind of device, shown at the workstation. */
export function deviceLabel(userAgent: string | undefined): string {
  const agent = userAgent ?? '';
  if (/iPad/.test(agent)) return 'iPad';
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? 'Android-Handy' : 'Android-Tablet';
  return 'Gerät';
}
