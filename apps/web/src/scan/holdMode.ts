const KEY = 'inventur.scanHoldMode';

/**
 * Whether the phone only scans while the scan button is held; remembered per
 * device. Holding is the default, continuous scanning has to be chosen.
 */
export function loadHoldMode(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveHoldMode(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // Not remembered without storage.
  }
}
