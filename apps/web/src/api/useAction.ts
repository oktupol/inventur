import { useCallback, useState } from 'react';
import { ApiRequestError } from './client.ts';

export interface Action {
  /** Runs the request; returns false and shows the error if it fails. */
  run: (request: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
  error: ApiRequestError | undefined;
  clearError: () => void;
}

/** State of a user-triggered API request such as creating or deleting a record. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError>();
  const run = useCallback(async (request: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await request();
      return true;
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError('internal_error', 0));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const clearError = useCallback(() => setError(undefined), []);
  return { run, busy, error, clearError };
}
