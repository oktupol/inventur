/** A code that the camera keeps seeing is ignored for this long. */
export const REPEAT_WINDOW_MS = 2000;

/**
 * Suppresses repeated reads of the same code: the camera detects a code in
 * many frames per second. The same code counts again only after it was out
 * of sight for the window; another code counts right away.
 */
export class ScanDebouncer {
  private lastCode: string | null = null;
  private lastSeen = -Infinity;
  private readonly windowMs: number;

  constructor(windowMs = REPEAT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Returns whether a detection at time `now` (ms) is a new scan. */
  accept(code: string, now: number): boolean {
    const repeated = code === this.lastCode && now - this.lastSeen < this.windowMs;
    this.lastCode = code;
    this.lastSeen = now;
    return !repeated;
  }
}
