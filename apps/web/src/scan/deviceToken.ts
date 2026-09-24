const KEY = 'inventur.deviceToken';

/** The device token keeps a phone paired across reloads. */
export function loadDeviceToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveDeviceToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Without storage the phone has to pair again after a reload.
  }
}

export function clearDeviceToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
