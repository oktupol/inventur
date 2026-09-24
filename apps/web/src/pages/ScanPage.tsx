import {
  DEVICE_TOKEN_HEADER,
  workstationChannel,
  type PairResponse,
  type StationState,
} from '@inventur/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, createApi } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { ConnectionIndicator } from '../realtime/ConnectionIndicator.tsx';
import { clearDeviceToken, loadDeviceToken, saveDeviceToken } from '../scan/deviceToken.ts';
import { PairForm } from '../scan/PairForm.tsx';
import { ScannerView } from '../scan/ScannerView.tsx';

function PairedView({
  token,
  onUnpaired,
}: {
  token: string;
  onUnpaired: (notice?: string) => void;
}) {
  const headers = useMemo(() => ({ [DEVICE_TOKEN_HEADER]: token }), [token]);
  const deviceApi = useMemo(() => createApi(headers), [headers]);
  const [workstationId, setWorkstationId] = useState<number>();
  const me = useApiData<StationState>('/api/scan/me', {
    channels: workstationId ? [workstationChannel(workstationId)] : [],
    headers,
  });
  const id = me.data?.workstation.id;
  if (id !== undefined && id !== workstationId) setWorkstationId(id);
  const disconnect = useAction();

  const unknown = me.error?.code === 'device_unknown';
  useEffect(() => {
    if (unknown)
      onUnpaired('Die Kopplung wurde an der Station oder durch das Ende der Inventur getrennt.');
  }, [unknown, onUnpaired]);

  async function unpair() {
    if (await disconnect.run(() => deviceApi.delete('/api/scan/pairing'))) onUnpaired();
  }

  const state = me.data;
  const notice = !state
    ? undefined
    : !state.stocktake
      ? 'Es läuft keine Inventur.'
      : !state.workArea
        ? 'Die Station ist keinem Arbeitsbereich beigetreten.'
        : state.employees.length === 0
          ? 'An der Station ist kein Mitarbeiter angemeldet.'
          : undefined;
  return (
    <div className="scan-screen">
      <header className="scan-bar">
        <div className="scan-bar-title">
          <strong>{state ? state.workstation.name : 'Handy-Scanner'}</strong>
          {state?.workArea && <span className="muted"> · {state.workArea.name}</span>}
        </div>
        <ConnectionIndicator />
        <button
          type="button"
          className="small"
          disabled={disconnect.busy}
          onClick={() => void unpair()}
        >
          Trennen
        </button>
      </header>
      <h1 className="visually-hidden">Handy-Scanner</h1>
      {!unknown && <ErrorNotice error={me.error ?? disconnect.error} />}
      {state && <ScannerView api={deviceApi} notice={notice} />}
    </div>
  );
}

export function ScanPage() {
  const [token, setToken] = useState(loadDeviceToken);
  const [notice, setNotice] = useState<string>();
  const [params, setParams] = useSearchParams();
  const qrToken = params.get('t');
  const pairByQr = useAction();

  const onPaired = (response: PairResponse) => {
    saveDeviceToken(response.deviceToken);
    setNotice(undefined);
    setToken(response.deviceToken);
  };

  const onUnpaired = useMemo(
    () => (message?: string) => {
      clearDeviceToken();
      setToken(null);
      setNotice(message);
    },
    [],
  );

  // Opened from the QR code: pair right away and remove the one-time token from the address.
  useEffect(() => {
    if (!qrToken) return;
    setParams({}, { replace: true });
    void pairByQr.run(async () =>
      onPaired(await api.post<PairResponse>('/api/scan/pair', { qrToken })),
    );
    // Only for the token in the address when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  if (token) return <PairedView key={token} token={token} onUnpaired={onUnpaired} />;
  return (
    <>
      {pairByQr.error && (
        <div className="scan-page" style={{ paddingBottom: 0 }}>
          <ErrorNotice error={pairByQr.error} />
        </div>
      )}
      <PairForm onPaired={onPaired} notice={notice} />
    </>
  );
}
