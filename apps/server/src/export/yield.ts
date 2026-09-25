import { setImmediate } from 'node:timers/promises';

/**
 * Returns a function to call once per item that lets other requests run
 * every `interval` items, so large exports do not delay scans.
 */
export function yieldEvery(interval = 1000): () => Promise<void> | undefined {
  let count = 0;
  return () => (++count % interval === 0 ? setImmediate() : undefined);
}
