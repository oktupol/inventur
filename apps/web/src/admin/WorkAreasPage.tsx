import type { WorkArea } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ConfirmDialog, Dialog } from '../components/Dialog.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { CloseWorkAreaDialog, WorkAreaStatusBadge } from '../components/WorkArea.tsx';
import { formatNumber } from '../format.ts';
import { NoActiveStocktake, useActiveStocktake } from './ActiveStocktake.tsx';
import { ImportButton } from './ImportButton.tsx';

export interface WorkAreaTableProps {
  workAreas: readonly WorkArea[];
  onEdit?: (workArea: WorkArea) => void;
  onDelete?: (workArea: WorkArea) => void;
  onClose?: (workArea: WorkArea) => void;
  onReopen?: (workArea: WorkArea) => void;
}

export function WorkAreaTable({
  workAreas,
  onEdit,
  onDelete,
  onClose,
  onReopen,
}: WorkAreaTableProps) {
  if (workAreas.length === 0) return <p className="muted">Noch keine Arbeitsbereiche.</p>;
  const editable = onEdit !== undefined || onDelete !== undefined;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Beschreibung</th>
            <th>Status</th>
            <th>Stationen</th>
            <th className="number">Zeilen</th>
            <th className="number">Stück</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {workAreas.map((area) => (
            <tr key={area.id}>
              <td>{area.name}</td>
              <td>{area.description ?? ''}</td>
              <td>
                <WorkAreaStatusBadge status={area.status} />
              </td>
              <td>{area.workstations.map((w) => w.name).join(', ')}</td>
              <td className="number">{formatNumber(area.entryCount)}</td>
              <td className="number">{formatNumber(area.quantity)}</td>
              {editable && (
                <td className="actions">
                  {onClose && area.status !== 'closed' && (
                    <button type="button" className="small" onClick={() => onClose(area)}>
                      Abschließen
                    </button>
                  )}
                  {onReopen && area.status === 'closed' && (
                    <button type="button" className="small" onClick={() => onReopen(area)}>
                      Wieder öffnen
                    </button>
                  )}
                  {onEdit && (
                    <button type="button" className="small" onClick={() => onEdit(area)}>
                      Bearbeiten
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="small"
                      disabled={area.entryCount > 0}
                      title={
                        area.entryCount > 0
                          ? 'Bereiche mit Erfassungen können nicht gelöscht werden.'
                          : undefined
                      }
                      onClick={() => onDelete(area)}
                    >
                      Löschen
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditWorkAreaDialog({
  url,
  workArea,
  onDone,
}: {
  url: string;
  workArea: WorkArea;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(workArea.name);
  const [description, setDescription] = useState(workArea.description ?? '');
  const action = useAction();

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (await action.run(() => api.patch(`${url}/${workArea.id}`, { name, description }))) {
      onDone(true);
    }
  }

  return (
    <Dialog
      title="Arbeitsbereich bearbeiten"
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
        <label>
          Beschreibung
          <input value={description} onChange={(e) => setDescription(e.target.value)} size={30} />
        </label>
        <button type="submit" hidden />
      </form>
      <div style={{ marginTop: '0.75rem' }}>
        <ErrorNotice error={action.error} />
      </div>
    </Dialog>
  );
}

function ManageWorkAreas({ stocktakeId }: { stocktakeId: number }) {
  const url = `/api/admin/stocktakes/${stocktakeId}/work-areas`;
  const workAreas = useApiData<WorkArea[]>(url, { channels: ['admin'] });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useAction();
  const remove = useAction();
  const [editing, setEditing] = useState<WorkArea>();
  const [deleting, setDeleting] = useState<WorkArea>();
  const [closing, setClosing] = useState<WorkArea>();
  const transition = useAction();

  async function runTransition(workArea: WorkArea, action: 'close' | 'reopen') {
    await transition.run(() => api.post(`${url}/${workArea.id}/${action}`));
    setClosing(undefined);
    workAreas.reload();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await create.run(() => api.post(url, { name, description }))) {
      setName('');
      setDescription('');
      workAreas.reload();
    }
  }

  async function confirmDelete(workArea: WorkArea) {
    const ok = await remove.run(() => api.delete(`${url}/${workArea.id}`));
    setDeleting(undefined);
    if (ok) workAreas.reload();
  }

  return (
    <>
      <div className="card">
        <form className="form-row" onSubmit={(e) => void submit(e)}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                create.clearError();
              }}
              placeholder="z. B. Vitrine 3"
              size={24}
            />
          </label>
          <label>
            Beschreibung (optional)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="z. B. links neben dem Eingang"
              size={30}
            />
          </label>
          <button type="submit" className="primary" disabled={create.busy || !name.trim()}>
            Hinzufügen
          </button>
        </form>
        <div style={{ marginTop: '0.75rem' }}>
          <ErrorNotice error={create.error} />
        </div>
        <ImportButton url={`${url}/import`} noun={['Arbeitsbereich', 'Arbeitsbereiche']} />
      </div>
      <div className="card">
        <ErrorNotice error={workAreas.error ?? remove.error ?? transition.error} />
        {workAreas.data && (
          <WorkAreaTable
            workAreas={workAreas.data}
            onEdit={setEditing}
            onDelete={setDeleting}
            onClose={setClosing}
            onReopen={(area) => void runTransition(area, 'reopen')}
          />
        )}
      </div>
      {editing && (
        <EditWorkAreaDialog
          url={url}
          workArea={editing}
          onDone={(saved) => {
            setEditing(undefined);
            if (saved) workAreas.reload();
          }}
        />
      )}
      {closing && (
        <CloseWorkAreaDialog
          workArea={closing}
          busy={transition.busy}
          onConfirm={() => void runTransition(closing, 'close')}
          onCancel={() => setClosing(undefined)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Arbeitsbereich löschen"
          confirmLabel="Löschen"
          danger
          busy={remove.busy}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(undefined)}
        >
          <p>
            Soll der Arbeitsbereich <strong>{deleting.name}</strong> gelöscht werden?
            {deleting.workstations.length > 0 &&
              ` Die Stationen ${deleting.workstations.map((w) => w.name).join(', ')} verlassen ihn dabei.`}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function WorkAreasPage() {
  const { stocktake } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Arbeitsbereiche</h1>
      </div>
      {stocktake === null && <NoActiveStocktake />}
      {stocktake && <ManageWorkAreas stocktakeId={stocktake.id} />}
    </>
  );
}
