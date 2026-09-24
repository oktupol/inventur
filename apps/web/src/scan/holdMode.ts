const KEY = 'inventur.scanHoldMode';

/** Whether the phone only scans while the scan button is held; remembered per device. */
export function loadHoldMode(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveHoldMode(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // Not remembered without storage.
  }
}
