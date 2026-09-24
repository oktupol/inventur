import {
  REALTIME_PATH,
  type Channel,
  type ConnectionStatus,
  type EventHandler,
  type RealtimeClient,
} from '@inventur/shared';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** WebSocket URL on the same host as the page, so it works behind the proxy on HTTP and HTTPS. */
export function realtimeUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${REALTIME_PATH}`;
}

/** Provides one shared realtime connection to the whole app. */
export function RealtimeProvider({
  client,
  children,
}: {
  client: RealtimeClient;
  children: ReactNode;
}) {
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

function useRealtimeClient(): RealtimeClient {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error('useRealtime hooks require a RealtimeProvider');
  return client;
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useRealtimeClient();
  return useSyncExternalStore(
    (onChange) => client.onStatusChange(onChange),
    () => client.status,
  );
}

/** Calls the handler for every event of the given channels while the component is mounted. */
export function useRealtimeEvents(channels: readonly Channel[], handler: EventHandler): void {
  const client = useRealtimeClient();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const key = [...channels].sort().join(',');
  useEffect(() => {
    if (key === '') return;
    return client.subscribe(key.split(',') as Channel[], (event) => handlerRef.current(event));
  }, [client, key]);
}
