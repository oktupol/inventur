import { workAreaChannel, type WorkArea } from '@inventur/shared';
import { useState } from 'react';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice, Notice } from '../components/Notice.tsx';
import { CloseWorkAreaDialog, WorkAreaStatusBadge } from '../components/WorkArea.tsx';
import { formatNumber } from '../format.ts';
import { useStation } from './StationContext.tsx';

/** Choose the work area of the workstation, leave it, close it or reopen closed ones. */
export function WorkAreaPanel() {
  const { api, headers, state, reload } = useStation();
  // Entries of the own area change its quantity, shown here and in the close dialog.
  const workAreas = useApiData<WorkArea[]>('/api/station/work-areas', {
    channels: state.workArea
      ? ['workstations', workAreaChannel(state.workArea.id)]
      : ['workstations'],
    filter: (event) =>
      event.type === 'work_area.changed' ||
      event.type === 'workstation.changed' ||
      event.type === 'entry.changed',
    headers,
  });
  const action = useAction();
  const [closing, setClosing] = useState(false);

  // Notice when the area was closed by another workstation or the administrator,
  // but not when this workstation left or closed it itself.
  const [previousArea, setPreviousArea] = useState(state.workArea);
  const [leavingOnPurpose, setLeavingOnPurpose] = useState(false);
  const [closedNotice, setClosedNotice] = useState<string>();
  if (previousArea?.id !== state.workArea?.id) {
    setPreviousArea(state.workArea);
    setLeavingOnPurpose(false);
    setClosedNotice(
      previousArea && !state.workArea && !leavingOnPurpose
        ? `Der Arbeitsbereich „${previousArea.name}“ wurde von einer anderen Station oder im Admin-Dashboard abgeschlossen.`
        : undefined,
    );
  }

  async function run(url: string, { leaving = false } = {}) {
    setClosedNotice(undefined);
    setLeavingOnPurpose(leaving);
    if (!(await action.run(() => api.post(url)))) setLeavingOnPurpose(false);
    reload();
    workAreas.reload();
  }

  const list = workAreas.data ?? [];
  const current = state.workArea && list.find((area) => area.id === state.workArea!.id);

  if (state.workArea) {
    return (
      <section className="card" aria-labelledby="work-area-heading">
        <div className="page-header">
          <div>
            <h2 id="work-area-heading" style={{ marginBottom: '0.25rem' }}>
              {state.workArea.name} <WorkAreaStatusBadge status={state.workArea.status} />
            </h2>
            {current && (
              <div className="muted">
                {formatNumber(current.quantity)} Stück in {formatNumber(current.entryCount)} Zeilen
                {current.workstations.length > 1 &&
                  ` · gemeinsam mit ${current.workstations
                    .filter((w) => w.id !== state.workstation.id)
                    .map((w) => w.name)
                    .join(', ')}`}
              </div>
            )}
          </div>
          <div className="row">
            <button
              type="button"
              disabled={action.busy}
              onClick={() => void run('/api/station/work-area/leave', { leaving: true })}
            >
              Bereich verlassen
            </button>
            <button
              type="button"
              className="primary"
              disabled={action.busy || !current}
              onClick={() => {
                // Show the current quantity in the safety question.
                workAreas.reload();
                setClosing(true);
              }}
            >
              Abschließen
            </button>
          </div>
        </div>
        <ErrorNotice error={action.error} />
        {closing && current && (
          <CloseWorkAreaDialog
            workArea={current}
            busy={action.busy}
            onCancel={() => setClosing(false)}
            onConfirm={() => {
              void run(`/api/station/work-areas/${current.id}/close`, { leaving: true }).then(() =>
                setClosing(false),
              );
            }}
          />
        )}
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="work-area-heading">
      <h2 id="work-area-heading">Arbeitsbereich wählen</h2>
      {closedNotice && <Notice kind="warning">{closedNotice}</Notice>}
      <ErrorNotice error={action.error ?? workAreas.error} />
      {workAreas.data && list.length === 0 && (
        <p className="muted">Im Admin-Dashboard wurden noch keine Arbeitsbereiche angelegt.</p>
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bereich</th>
                <th>Status</th>
                <th>Stationen</th>
                <th className="number">Stück</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((area) => (
                <tr key={area.id}>
                  <td>
                    <strong>{area.name}</strong>
                    {area.description && <div className="muted">{area.description}</div>}
                  </td>
                  <td>
                    <WorkAreaStatusBadge status={area.status} />
                  </td>
                  <td>{area.workstations.map((w) => w.name).join(', ')}</td>
                  <td className="number">{formatNumber(area.quantity)}</td>
                  <td className="actions">
                    {area.status === 'closed' ? (
                      <button
                        type="button"
                        disabled={action.busy}
                        onClick={() => void run(`/api/station/work-areas/${area.id}/reopen`)}
                      >
                        Wieder öffnen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={action.busy}
                        onClick={() => void run(`/api/station/work-areas/${area.id}/join`)}
                      >
                        Beitreten
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
