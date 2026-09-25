import {
  AUDIT_ACTIONS,
  type AuditLogResponse,
  type AuditLogEntry,
  type Stocktake,
  type WorkArea,
  type Workstation,
} from '@inventur/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiRequestError } from '../api/client.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { AUDIT_ACTION_LABELS, AUDIT_SOURCE_LABELS, formatDateTime } from '../format.ts';
import { NoActiveStocktake, useActiveStocktake } from './ActiveStocktake.tsx';
import { describeChange, mergeAuditPages } from './audit-log.ts';

interface Filters {
  workAreaId: string;
  workstationId: string;
  action: string;
}

const NO_FILTERS: Filters = { workAreaId: '', workstationId: '', action: '' };

function queryOf(filters: Filters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(
    Object.entries({ ...filters, ...extra }).filter(([, value]) => value !== ''),
  );
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Audit log entries, newest first. */
export function AuditLogTable({ entries }: { entries: readonly AuditLogEntry[] }) {
  if (entries.length === 0) return <p className="muted">Keine Einträge.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            <th>Aktion</th>
            <th>Arbeitsbereich</th>
            <th>Artikel</th>
            <th>Änderung</th>
            <th>Station</th>
            <th>Mitarbeiter</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={`audit-${entry.action}`}>
              <td>{formatDateTime(entry.createdAt)}</td>
              <td>{AUDIT_ACTION_LABELS[entry.action]}</td>
              <td>{entry.workArea?.name ?? ''}</td>
              <td>
                {entry.description}
                {entry.code && <div className="muted">{entry.code}</div>}
              </td>
              <td>{describeChange(entry)}</td>
              <td>
                {entry.workstation?.name ?? AUDIT_SOURCE_LABELS[entry.source]}
                {entry.source === 'phone' && <span className="muted"> (Handy)</span>}
              </td>
              <td>{entry.employees.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The audit log of a stocktake with filters, live updates and exports. */
function AuditLogView({ stocktakeId }: { stocktakeId: number }) {
  const base = `/api/admin/stocktakes/${stocktakeId}`;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Older pages belong to the filters they were loaded with.
  const [olderPages, setOlderPages] = useState<{
    key: string;
    entries: AuditLogEntry[];
    hasMore: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiRequestError>();
  const first = useApiData<AuditLogResponse>(`${base}/audit-log${queryOf(filters)}`, {
    channels: ['admin'],
    filter: (event) => event.type === 'entry.changed' || event.type === 'stocktake.changed',
    throttleMs: 1000,
  });
  const workAreas = useApiData<WorkArea[]>(`${base}/work-areas`);
  const workstations = useApiData<Workstation[]>('/api/admin/workstations');

  const key = queryOf(filters);
  const older = olderPages?.key === key ? olderPages : null;
  const entries = mergeAuditPages(first.data?.entries ?? [], older?.entries ?? []);
  const hasMore = older ? older.hasMore : (first.data?.hasMore ?? false);

  const loadMore = async () => {
    const oldest = entries.at(-1);
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const page = await api.get<AuditLogResponse>(
        `${base}/audit-log${queryOf(filters, { before: String(oldest.id) })}`,
      );
      setOlderPages((previous) => ({
        key,
        entries: [...(previous?.key === key ? previous.entries : []), ...page.entries],
        hasMore: page.hasMore,
      }));
      setMoreError(undefined);
    } catch (error) {
      setMoreError(error instanceof ApiRequestError ? error : undefined);
    } finally {
      setLoadingMore(false);
    }
  };

  const change = (filter: keyof Filters) => (event: { target: { value: string } }) => {
    setFilters((previous) => ({ ...previous, [filter]: event.target.value }));
    setMoreError(undefined);
  };
  const exportUrl = (format: 'csv' | 'xlsx') =>
    `${base}/audit-log/export${queryOf(filters, { format })}`;

  return (
    <div className="card">
      <div className="form-row">
        <label>
          Arbeitsbereich
          <select value={filters.workAreaId} onChange={change('workAreaId')}>
            <option value="">Alle</option>
            {(workAreas.data ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Station
          <select value={filters.workstationId} onChange={change('workstationId')}>
            <option value="">Alle</option>
            {(workstations.data ?? []).map((workstation) => (
              <option key={workstation.id} value={workstation.id}>
                {workstation.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Aktion
          <select value={filters.action} onChange={change('action')}>
            <option value="">Alle</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        <div className="spacer" />
        <a className="button small" href={exportUrl('csv')} download>
          CSV
        </a>
        <a className="button small" href={exportUrl('xlsx')} download>
          Excel (XLSX)
        </a>
      </div>
      <ErrorNotice error={first.error} />
      {first.data && <AuditLogTable entries={entries} />}
      <ErrorNotice error={moreError} />
      {hasMore && (
        <p>
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            Ältere Einträge laden
          </button>
        </p>
      )}
    </div>
  );
}

const INTRO =
  'Nachträgliche Änderungen an Erfassungen sowie das Beenden und Wiederöffnen der Inventur, neueste zuerst.';

export function AuditLogPage() {
  const { stocktake } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Änderungsprotokoll</h1>
      </div>
      <p className="muted">{INTRO}</p>
      {stocktake === null && <NoActiveStocktake />}
      {stocktake && <AuditLogView stocktakeId={stocktake.id} />}
    </>
  );
}

/** Audit log of a stocktake from the history. */
export function StocktakeAuditLogPage() {
  const { id } = useParams();
  const stocktake = useApiData<Stocktake>(`/api/admin/stocktakes/${Number(id)}`);
  return (
    <>
      <p>
        <Link to={`/admin/historie/${Number(id)}`}>← Zurück zur Inventur</Link>
      </p>
      <div className="page-header">
        <h1>Änderungsprotokoll{stocktake.data && ` – ${stocktake.data.name}`}</h1>
      </div>
      <p className="muted">{INTRO}</p>
      <AuditLogView stocktakeId={Number(id)} />
    </>
  );
}
