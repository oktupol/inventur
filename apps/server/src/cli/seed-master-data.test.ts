import { describe, expect, it } from 'vitest';
import { parseSeedArgs } from './seed-master-data.ts';

describe('parseSeedArgs', () => {
  it('uses defaults and a random seed', () => {
    expect(parseSeedArgs([], () => 99)).toEqual({
      help: false,
      count: 5000,
      seed: 99,
      replace: false,
    });
  });

  it('reads all options', () => {
    expect(parseSeedArgs(['--count', '100', '--seed', '42', '--replace'])).toEqual({
      help: false,
      count: 100,
      seed: 42,
      replace: true,
    });
  });

  it('recognizes --help', () => {
    expect(parseSeedArgs(['--help'])).toEqual({ help: true });
  });

  it.each([
    [['--count', '0']],
    [['--count', 'abc']],
    [['--count', '1.5']],
    [['--seed', '-1']],
    [['--unknown']],
  ])('rejects %j', (args) => {
    expect(() => parseSeedArgs(args)).toThrow();
  });
});
