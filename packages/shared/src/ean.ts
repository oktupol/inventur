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
