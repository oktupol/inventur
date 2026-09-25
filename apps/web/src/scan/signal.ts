import { playDuplicateTone, playTone } from '../station/audio.ts';

/** A scan result; `duplicate` is a unique result for an article captured before. */
export type SignalKind = 'unique' | 'duplicate' | 'ambiguous' | 'not_found';

/** Vibration and tone for a scan result; both are silently skipped where unsupported. */
export function signal(kind: SignalKind): void {
  const vibrate = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Not supported, e.g. on iOS.
    }
  };
  switch (kind) {
    case 'unique':
      vibrate(80);
      playTone({ frequency: 880, durationMs: 120 });
      break;
    case 'duplicate':
      vibrate([150, 100, 150]);
      playDuplicateTone();
      break;
    case 'ambiguous':
      vibrate([60, 60, 60]);
      playTone({ frequency: 600, durationMs: 200 });
      break;
    case 'not_found':
      vibrate(400);
      playTone({ frequency: 220, durationMs: 400 });
      break;
  }
}
