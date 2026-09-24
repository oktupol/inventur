import type { Employee, Stocktake, WorkArea } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatDateTime, formatNumber } from '../format.ts';
import { useActiveStocktake } from './ActiveStocktake.tsx';
import { FinishStocktakeDialog } from './FinishStocktakeDialog.tsx';

function StartStocktake({ onStarted }: { onStarted: () => void }) {
  const [name, setName] = useState(() => `Inventur ${new Date().getFullYear()}`);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await action.run(() => api.post('/api/admin/stocktakes', { name }))) onStarted();
  }

  return (
    <div className="card">
      <h2>Neue Inventur starten</h2>
      <p className="muted">Es läuft derzeit keine Inventur.</p>
      <form className="form-row" onSubmit={(e) => void submit(e)}>
        <label>
          Bezeichnung
          <input value={name} onChange={(e) => setName(e.target.value)} required size={30} />
        </label>
        <button type="submit" className="primary" disabled={action.busy || !name.trim()}>
          Inventur starten
        </button>
      </form>
      <div style={{ marginTop: '1rem' }}>
        <ErrorNotice error={action.error} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="value">{formatNumber(value)}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function ActiveStocktake({
  stocktake,
  onFinished,
}: {
  stocktake: Stocktake;
  onFinished: () => void;
}) {
  const base = `/api/admin/stocktakes/${stocktake.id}`;
  const workAreas = useApiData<WorkArea[]>(`${base}/work-areas`, { channels: ['admin'] });
  const employees = useApiData<Employee[]>(`${base}/employees`, { channels: ['admin'] });
  const [finishing, setFinishing] = useState(false);

  const areas = workAreas.data ?? [];
  const count = (status: WorkArea['status']) => areas.filter((a) => a.status === status).length;
  const loggedIn = (employees.data ?? []).filter((e) => e.workstation !== null).length;

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h2 style={{ marginBottom: '0.25rem' }}>
            {stocktake.name} <span className="badge active">aktiv</span>
          </h2>
          <div className="muted">Gestartet am {formatDateTime(stocktake.startedAt)}</div>
        </div>
        <button
          type="button"
          className="danger"
          disabled={!workAreas.data}
          onClick={() => setFinishing(true)}
        >
          Inventur beenden
        </button>
      </div>
      <ErrorNotice error={workAreas.error ?? employees.error} />
      <div className="stats">
        <Stat label="Bereiche offen" value={count('open')} />
        <Stat label="Bereiche in Arbeit" value={count('in_progress')} />
        <Stat label="Bereiche abgeschlossen" value={count('closed')} />
        <Stat label="Mitarbeiter" value={employees.data?.length ?? 0} />
        <Stat label="davon angemeldet" value={loggedIn} />
        <Stat label="Zeilen" value={areas.reduce((sum, a) => sum + a.entryCount, 0)} />
        <Stat label="Stück" value={areas.reduce((sum, a) => sum + a.quantity, 0)} />
      </div>
      <div className="row">
        <Link to="/admin/mitarbeiter">Mitarbeiter verwalten</Link>
        <span className="muted">·</span>
        <Link to="/admin/bereiche">Arbeitsbereiche verwalten</Link>
      </div>
      {finishing && (
        <FinishStocktakeDialog
          stocktake={stocktake}
          workAreas={areas}
          onCancel={() => setFinishing(false)}
          onFinished={() => {
            setFinishing(false);
            onFinished();
          }}
        />
      )}
    </div>
  );
}

export function StocktakePage() {
  const { stocktake, reload } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Inventur</h1>
      </div>
      {stocktake === undefined ? (
        <p className="muted">Wird geladen …</p>
      ) : stocktake === null ? (
        <StartStocktake onStarted={reload} />
      ) : (
        <ActiveStocktake stocktake={stocktake} onFinished={reload} />
      )}
    </>
  );
}
