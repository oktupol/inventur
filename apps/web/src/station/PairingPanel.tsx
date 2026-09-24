import { workstationChannel, type PairedDevice } from '@inventur/shared';
import { useState } from 'react';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatTime } from '../format.ts';
import { PairingDialog } from './PairingDialog.tsx';
import { useStation } from './StationContext.tsx';

/** Phones paired with this workstation as camera scanners. */
export function PairingPanel() {
  const { api, headers, state } = useStation();
  const devices = useApiData<PairedDevice[]>('/api/station/pairings', {
    channels: [workstationChannel(state.workstation.id)],
    filter: (event) => event.type === 'pairing.changed' || event.type === 'workstation.changed',
    headers,
  });
  const [pairing, setPairing] = useState(false);
  const disconnect = useAction();

  async function remove(device: PairedDevice) {
    await disconnect.run(() => api.delete(`/api/station/pairings/${device.id}`));
    devices.reload();
  }

  const list = devices.data ?? [];
  return (
    <section className="card" aria-labelledby="devices-heading">
      <div className="page-header" style={{ marginBottom: list.length > 0 ? '0.75rem' : 0 }}>
        <h2 id="devices-heading" style={{ margin: 0 }}>
          Handys
        </h2>
        <button type="button" onClick={() => setPairing(true)}>
          Handy koppeln
        </button>
      </div>
      {list.length > 0 && (
        <ul className="chips">
          {list.map((device) => (
            <li key={device.id} className="chip">
              {device.label} · seit {formatTime(device.pairedAt)}
              <button
                type="button"
                className="small"
                disabled={disconnect.busy}
                onClick={() => void remove(device)}
              >
                Trennen
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={disconnect.error ?? devices.error} />
      {pairing && (
        <PairingDialog
          onClose={() => {
            setPairing(false);
            devices.reload();
          }}
        />
      )}
    </section>
  );
}
