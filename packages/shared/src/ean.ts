/** Computes the check digit of an EAN-13 from its first twelve digits. */
export function ean13CheckDigit(twelveDigits: string): number {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error(`Expected twelve digits, got: ${twelveDigits}`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // Counting from the left: odd positions weigh 1, even positions weigh 3.
    sum += Number(twelveDigits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** Appends the check digit to twelve digits, yielding a complete EAN-13. */
export function ean13(twelveDigits: string): string {
  return twelveDigits + ean13CheckDigit(twelveDigits);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Whether an EAN-8 or EAN-13 has the correct check digit. Counting from the
 * check digit leftwards, the digits weigh 3, 1, 3, … (GTIN rule).
 */
export function hasValidEanCheckDigit(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}
