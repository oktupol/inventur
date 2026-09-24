import type { Channel, DomainEvent } from '@inventur/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnectionStatus, useRealtimeEvents } from '../realtime/RealtimeProvider.tsx';
import { api, ApiRequestError } from './client.ts';

export interface ApiData<T> {
  data: T | undefined;
  error: ApiRequestError | undefined;
  loading: boolean;
  reload: () => void;
}

export interface ApiDataOptions {
  /** Channels whose events trigger a reload. */
  channels?: readonly Channel[];
  /** Restricts reloads to matching events; by default every event reloads. */
  filter?: (event: DomainEvent) => boolean;
}

/** Delay that merges bursts of events, e.g. when a stocktake is finished, into one reload. */
const RELOAD_DELAY_MS = 50;

/**
 * Loads JSON from the API and keeps it current: it reloads on realtime events
 * and after a reconnect, because events may have been missed meanwhile.
 * With `url` null, nothing is loaded.
 */
export function useApiData<T>(url: string | null, options: ApiDataOptions = {}): ApiData<T> {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: ApiRequestError }>({
    url,
  });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    api.get<T>(url).then(
      (data) => !cancelled && setState({ url, data }),
      (error: unknown) =>
        !cancelled &&
        setState((previous) => ({
          url,
          // Keep showing the last data of the same URL if a reload fails.
          data: previous.url === url ? previous.data : undefined,
          error:
            error instanceof ApiRequestError ? error : new ApiRequestError('internal_error', 0),
        })),
    );
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const filterRef = useRef(options.filter);
  useEffect(() => {
    filterRef.current = options.filter;
  });
  useRealtimeEvents(options.channels ?? [], (event) => {
    if (filterRef.current && !filterRef.current(event)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(reload, RELOAD_DELAY_MS);
  });

  const status = useConnectionStatus();
  const lastStatus = useRef(status);
  const wasOpenBefore = useRef(status === 'open');
  useEffect(() => {
    if (status === lastStatus.current) return;
    lastStatus.current = status;
    if (status !== 'open') return;
    if (wasOpenBefore.current) reload();
    wasOpenBefore.current = true;
  }, [status, reload]);

  const current = state.url === url;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: url !== null && (!current || (state.data === undefined && !state.error)),
    reload,
  };
}
