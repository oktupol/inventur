/** Parses a CLI option value as an integer of at least `min`. */
export function parseInteger(name: string, value: string, min: number): number {
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min) {
    throw new Error(`--${name} must be an integer >= ${min}, got: ${value}`);
  }
  return number;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
