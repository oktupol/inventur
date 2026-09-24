import type { StationEmployee } from '@inventur/shared';
import { useState } from 'react';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { unlockAudio } from './audio.ts';
import { useStation } from './StationContext.tsx';

/** Employees logged in to this workstation; only free employees can be added. */
export function EmployeePanel() {
  const { api, headers, state, reload } = useStation();
  const employees = useApiData<StationEmployee[]>('/api/station/employees', {
    channels: ['workstations'],
    filter: (event) => event.type === 'employee.changed',
    headers,
  });
  const [selected, setSelected] = useState('');
  const action = useAction();

  const free = (employees.data ?? []).filter((e) => e.workstation === null);

  async function login() {
    unlockAudio();
    const ok = await action.run(() => api.post(`/api/station/employees/${selected}/login`));
    if (ok) setSelected('');
    reload();
    employees.reload();
  }

  async function logout(id: number) {
    await action.run(() => api.post(`/api/station/employees/${id}/logout`));
    reload();
    employees.reload();
  }

  return (
    <section className="card" aria-labelledby="employees-heading">
      <h2 id="employees-heading">Angemeldete Mitarbeiter</h2>
      {state.employees.length === 0 ? (
        <p className="notice warning">
          Niemand angemeldet. Zum Erfassen muss mindestens ein Mitarbeiter angemeldet sein.
        </p>
      ) : (
        <ul className="chips">
          {state.employees.map((employee) => (
            <li key={employee.id} className="chip">
              {employee.name}
              <button
                type="button"
                className="small"
                disabled={action.busy}
                onClick={() => void logout(employee.id)}
              >
                Abmelden
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="form-row" style={{ marginTop: '0.75rem' }}>
        <label>
          Mitarbeiter anmelden
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">
              {free.length === 0 ? 'Keine freien Mitarbeiter' : 'Bitte wählen …'}
            </option>
            {free.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={action.busy || selected === ''}
          onClick={() => void login()}
        >
          Anmelden
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        Mitarbeiter, die an einer anderen Station angemeldet sind, müssen sich dort zuerst abmelden.
      </p>
      <div style={{ marginTop: '0.75rem' }}>
        <ErrorNotice error={action.error ?? employees.error} />
      </div>
    </section>
  );
}
