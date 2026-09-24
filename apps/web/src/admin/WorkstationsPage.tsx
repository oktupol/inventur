import type { Workstation } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ConfirmDialog, Dialog } from '../components/Dialog.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatDateTime, formatNumber } from '../format.ts';

const URL = '/api/admin/workstations';

function RenameDialog({
  workstation,
  onDone,
}: {
  workstation: Workstation;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(workstation.name);
  const action = useAction();

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (await action.run(() => api.patch(`${URL}/${workstation.id}`, { name }))) onDone(true);
  }

  return (
    <Dialog
      title="Arbeitsstation umbenennen"
      onClose={() => onDone(false)}
      actions={
        <>
          <button type="button" onClick={() => onDone(false)}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            disabled={action.busy || !name.trim()}
            onClick={() => void save()}
          >
            Speichern
          </button>
        </>
      }
    >
      <form className="form-row" onSubmit={(e) => void save(e)}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} size={30} />
        </label>
        <button type="submit" hidden />
      </form>
      <div style={{ marginTop: '0.75rem' }}>
        <ErrorNotice error={action.error} />
      </div>
    </Dialog>
  );
}

export function WorkstationsPage() {
  const workstations = useApiData<Workstation[]>(URL, { channels: ['admin'] });
  const remove = useAction();
  const [renaming, setRenaming] = useState<Workstation>();
  const [deleting, setDeleting] = useState<Workstation>();

  async function confirmDelete(workstation: Workstation) {
    const ok = await remove.run(() => api.delete(`${URL}/${workstation.id}`));
    setDeleting(undefined);
    if (ok) workstations.reload();
  }

  const list = workstations.data ?? [];
  return (
    <>
      <div className="page-header">
        <h1>Arbeitsstationen</h1>
      </div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Stationen registrieren sich selbst beim ersten Aufruf der Inventur-Seite und bleiben über
          Inventuren hinweg bestehen.
        </p>
        <ErrorNotice error={workstations.error ?? remove.error} />
        {workstations.data && list.length === 0 && (
          <p className="muted">Noch keine Arbeitsstationen registriert.</p>
        )}
        {list.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Arbeitsbereich</th>
                  <th>Angemeldete Mitarbeiter</th>
                  <th>Zuletzt gesehen</th>
                  <th className="number">Erfassungen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((workstation) => (
                  <tr key={workstation.id}>
                    <td>{workstation.name}</td>
                    <td>{workstation.workArea?.name ?? ''}</td>
                    <td>{workstation.employees.map((e) => e.name).join(', ')}</td>
                    <td>{formatDateTime(workstation.lastSeenAt)}</td>
                    <td className="number">{formatNumber(workstation.entryCount)}</td>
                    <td className="actions">
                      <button
                        type="button"
                        className="small"
                        onClick={() => setRenaming(workstation)}
                      >
                        Umbenennen
                      </button>
                      <button
                        type="button"
                        className="small"
                        disabled={workstation.entryCount > 0}
                        title={
                          workstation.entryCount > 0
                            ? 'Stationen mit Erfassungen können nicht gelöscht werden.'
                            : undefined
                        }
                        onClick={() => setDeleting(workstation)}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {renaming && (
        <RenameDialog
          workstation={renaming}
          onDone={(saved) => {
            setRenaming(undefined);
            if (saved) workstations.reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Arbeitsstation löschen"
          confirmLabel="Löschen"
          danger
          busy={remove.busy}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(undefined)}
        >
          <p>
            Soll die Arbeitsstation <strong>{deleting.name}</strong> gelöscht werden? Der Browser
            dieser Station muss sich danach neu registrieren.
            {deleting.employees.length > 0 &&
              ` Angemeldete Mitarbeiter (${deleting.employees.map((e) => e.name).join(', ')}) werden abgemeldet.`}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
