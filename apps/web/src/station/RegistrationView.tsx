import type { NamedRef, WorkstationRegistration } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice, Notice } from '../components/Notice.tsx';
import { unlockAudio } from './audio.ts';

export interface RegistrationViewProps {
  onRegistered: (registration: WorkstationRegistration) => void;
  /** Shown when the previous registration is no longer valid. */
  notice?: string;
}

/** First visit of a browser: register it as a new workstation or take over an existing one. */
export function RegistrationView({ onRegistered, notice }: RegistrationViewProps) {
  const [name, setName] = useState('');
  const [takeOverId, setTakeOverId] = useState('');
  const register = useAction();
  const takeOver = useAction();
  const workstations = useApiData<NamedRef[]>('/api/station/workstations');

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    unlockAudio();
    await register.run(async () =>
      onRegistered(await api.post<WorkstationRegistration>('/api/station/register', { name })),
    );
  }

  async function submitTakeOver(event: FormEvent) {
    event.preventDefault();
    unlockAudio();
    await takeOver.run(async () =>
      onRegistered(
        await api.post<WorkstationRegistration>('/api/station/take-over', {
          workstationId: Number(takeOverId),
        }),
      ),
    );
  }

  const existing = workstations.data ?? [];
  return (
    <div className="station-narrow">
      <h1>Arbeitsstation einrichten</h1>
      {notice && <Notice kind="warning">{notice}</Notice>}
      <div className="card">
        <h2>Neue Arbeitsstation</h2>
        <p className="muted">
          Dieser Browser wird unter einem Namen als Arbeitsstation registriert, z. B. nach dem
          Standort des Rechners.
        </p>
        <form className="form-row" onSubmit={(e) => void submitNew(e)}>
          <label>
            Name der Station
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                register.clearError();
              }}
              placeholder="z. B. Kasse 1"
              size={30}
              autoFocus
            />
          </label>
          <button type="submit" className="primary" disabled={register.busy || !name.trim()}>
            Registrieren
          </button>
        </form>
        <div style={{ marginTop: '0.75rem' }}>
          <ErrorNotice error={register.error} />
        </div>
      </div>
      {existing.length > 0 && (
        <div className="card">
          <h2>Bestehende Station übernehmen</h2>
          <p className="muted">
            Falls dieser Rechner schon registriert war und die Browserdaten verloren gegangen sind.
            Ein anderer Browser, der die Station noch nutzt, muss sich danach neu registrieren.
          </p>
          <form className="form-row" onSubmit={(e) => void submitTakeOver(e)}>
            <label>
              Station
              <select value={takeOverId} onChange={(e) => setTakeOverId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {existing.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={takeOver.busy || takeOverId === ''}>
              Übernehmen
            </button>
          </form>
          <div style={{ marginTop: '0.75rem' }}>
            <ErrorNotice error={takeOver.error} />
          </div>
        </div>
      )}
    </div>
  );
}
