import { describe, expect, it } from 'vitest';
import { parseTestSheetArgs } from './barcode-test-sheet.ts';

describe('parseTestSheetArgs', () => {
  it('uses defaults and a random seed', () => {
    expect(parseTestSheetArgs(['--output', 'blatt.pdf'], () => 5)).toEqual({
      help: false,
      output: 'blatt.pdf',
      count: 12,
      seed: 5,
    });
  });

  it('reads all options', () => {
    expect(parseTestSheetArgs(['--output', '/out/a.pdf', '--count', '3', '--seed', '42'])).toEqual({
      help: false,
      output: '/out/a.pdf',
      count: 3,
      seed: 42,
    });
  });

  it('recognizes --help without --output', () => {
    expect(parseTestSheetArgs(['--help'])).toEqual({ help: true });
  });

  it.each([[[]], [['--output', 'a.pdf', '--count', '0']], [['--output', 'a.pdf', '--x']]])(
    'rejects %j',
    (args) => {
      expect(() => parseTestSheetArgs(args)).toThrow();
    },
  );
});
