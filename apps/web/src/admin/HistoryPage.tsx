import type { Employee, Stocktake, StocktakeSummary, WorkArea } from '@inventur/shared';
import { Link, useParams } from 'react-router';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatDateTime, formatNumber, STOCKTAKE_STATUS_LABELS } from '../format.ts';
import { EmployeeTable } from './EmployeesPage.tsx';
import { WorkAreaTable } from './WorkAreasPage.tsx';

export function HistoryPage() {
  const stocktakes = useApiData<StocktakeSummary[]>('/api/admin/stocktakes', {
    channels: ['admin'],
  });
  const list = stocktakes.data ?? [];
  return (
    <>
      <div className="page-header">
        <h1>Historie</h1>
      </div>
      <div className="card">
        <ErrorNotice error={stocktakes.error} />
        {stocktakes.data && list.length === 0 && (
          <p className="muted">Es wurde noch keine Inventur durchgeführt.</p>
        )}
        {list.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Status</th>
                  <th>Gestartet</th>
                  <th>Beendet</th>
                  <th className="number">Bereiche abgeschl.</th>
                  <th className="number">Mitarbeiter</th>
                  <th className="number">Zeilen</th>
                  <th className="number">Stück</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/admin/historie/${s.id}`}>{s.name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${s.status}`}>
                        {STOCKTAKE_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td>{formatDateTime(s.startedAt)}</td>
                    <td>{formatDateTime(s.finishedAt)}</td>
                    <td className="number">
                      {formatNumber(s.closedWorkAreaCount)} / {formatNumber(s.workAreaCount)}
                    </td>
                    <td className="number">{formatNumber(s.employeeCount)}</td>
                    <td className="number">{formatNumber(s.entryCount)}</td>
                    <td className="number">{formatNumber(s.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Read-only view of one stocktake with its work areas and employees. */
export function StocktakeDetailPage() {
  const { id } = useParams();
  const base = `/api/admin/stocktakes/${Number(id)}`;
  const stocktake = useApiData<Stocktake>(base, { channels: ['admin'] });
  const workAreas = useApiData<WorkArea[]>(`${base}/work-areas`, { channels: ['admin'] });
  const employees = useApiData<Employee[]>(`${base}/employees`, { channels: ['admin'] });
  const s = stocktake.data;

  return (
    <>
      <p>
        <Link to="/admin/historie">← Zurück zur Historie</Link>
      </p>
      <ErrorNotice error={stocktake.error} />
      {s && (
        <>
          <div className="page-header">
            <h1>
              {s.name}{' '}
              <span className={`badge ${s.status}`}>{STOCKTAKE_STATUS_LABELS[s.status]}</span>
            </h1>
          </div>
          <p className="muted">
            Gestartet am {formatDateTime(s.startedAt)}
            {s.finishedAt && `, beendet am ${formatDateTime(s.finishedAt)}`}
          </p>
          <div className="card">
            <h2>Arbeitsbereiche</h2>
            <ErrorNotice error={workAreas.error} />
            {workAreas.data && <WorkAreaTable workAreas={workAreas.data} />}
          </div>
          <div className="card">
            <h2>Mitarbeiter</h2>
            <ErrorNotice error={employees.error} />
            {employees.data && <EmployeeTable employees={employees.data} />}
          </div>
        </>
      )}
    </>
  );
}
