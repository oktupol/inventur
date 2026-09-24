import {
  WORKSTATION_TOKEN_HEADER,
  workstationChannel,
  type StationState,
  type WorkstationRegistration,
} from '@inventur/shared';
import { useEffect, useMemo, useState } from 'react';
import { createApi } from '../api/client.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { ConnectionIndicator } from '../realtime/ConnectionIndicator.tsx';
import { installAudioUnlock } from '../station/audio.ts';
import { EmployeePanel } from '../station/EmployeePanel.tsx';
import { RegistrationView } from '../station/RegistrationView.tsx';
import { StationContext, type Station } from '../station/StationContext.tsx';
import { clearToken, loadToken, saveToken } from '../station/token.ts';

/** Interval in which the workstation reports itself as seen and refreshes its state. */
const HEARTBEAT_MS = 60_000;

function RegisteredStation({ token, onUnknown }: { token: string; onUnknown: () => void }) {
  const headers = useMemo(() => ({ [WORKSTATION_TOKEN_HEADER]: token }), [token]);
  const api = useMemo(() => createApi(headers), [headers]);
  // Known after the first response; until then only the shared channel is subscribed.
  const [workstationId, setWorkstationId] = useState<number>();
  const me = useApiData<StationState>('/api/station/me', {
    channels: workstationId
      ? ['workstations', workstationChannel(workstationId)]
      : ['workstations'],
    filter: (event) =>
      event.type === 'stocktake.changed' ||
      (event.type === 'workstation.changed' && event.workstationId === workstationId),
    headers,
  });
  const { reload } = me;
  const id = me.data?.workstation.id;
  if (id !== undefined && id !== workstationId) setWorkstationId(id);

  useEffect(() => {
    const timer = setInterval(reload, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const unknown = me.error?.code === 'workstation_unknown';
  useEffect(() => {
    if (unknown) onUnknown();
  }, [unknown, onUnknown]);

  const station: Station | null = me.data ? { api, headers, state: me.data, reload } : null;

  return (
    <>
      <header className="station-header">
        <div>
          <strong>{me.data?.workstation.name ?? 'Arbeitsstation'}</strong>
          {me.data?.stocktake && <span className="muted"> · {me.data.stocktake.name}</span>}
        </div>
        <ConnectionIndicator />
      </header>
      <main className="station-main">
        <h1 className="visually-hidden">Arbeitsstation</h1>
        {!unknown && <ErrorNotice error={me.error} />}
        {station && (
          <StationContext.Provider value={station}>
            {station.state.stocktake ? (
              <EmployeePanel />
            ) : (
              <div className="card no-stocktake">
                <h2>Keine aktive Inventur</h2>
                <p className="muted">
                  Sobald im Admin-Dashboard eine Inventur gestartet wird, geht es hier weiter.
                </p>
              </div>
            )}
          </StationContext.Provider>
        )}
      </main>
    </>
  );
}

export function StationPage() {
  const [token, setToken] = useState(loadToken);
  const [notice, setNotice] = useState<string>();

  useEffect(() => installAudioUnlock(), []);

  const onRegistered = (registration: WorkstationRegistration) => {
    saveToken(registration.token);
    setNotice(undefined);
    setToken(registration.token);
  };

  const onUnknown = useMemo(
    () => () => {
      clearToken();
      setToken(null);
      setNotice(
        'Diese Arbeitsstation ist nicht mehr registriert, z. B. weil sie gelöscht oder von einem anderen Browser übernommen wurde.',
      );
    },
    [],
  );

  if (!token) {
    return (
      <>
        <header className="station-header">
          <strong>Inventur</strong>
          <ConnectionIndicator />
        </header>
        <main className="station-main">
          <RegistrationView onRegistered={onRegistered} notice={notice} />
        </main>
      </>
    );
  }
  return <RegisteredStation key={token} token={token} onUnknown={onUnknown} />;
}
