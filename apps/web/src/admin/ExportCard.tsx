import type { WorkArea } from '@inventur/shared';
import { useState } from 'react';

type ExportKind = 'entries' | 'articles' | 'reconciliation';

const EXPORTS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'entries', label: 'Einzelzeilen', hint: 'Jede erfasste Zeile' },
  { kind: 'articles', label: 'Je Artikel', hint: 'Zeilen eines Artikels zusammengefasst' },
  {
    kind: 'reconciliation',
    label: 'Soll/Ist-Abgleich',
    hint: 'Fehlbestand und Mehrbestand der gesamten Inventur',
  },
];

/** Downloads of the results as CSV and XLSX, for all work areas or one of them. */
export function ExportCard({
  stocktakeId,
  workAreas,
}: {
  stocktakeId: number;
  workAreas: readonly WorkArea[];
}) {
  const [workAreaId, setWorkAreaId] = useState('');
  const url = (kind: ExportKind, format: 'csv' | 'xlsx') => {
    const area = kind !== 'reconciliation' && workAreaId ? `&workAreaId=${workAreaId}` : '';
    return `/api/admin/stocktakes/${stocktakeId}/export/${kind}?format=${format}${area}`;
  };

  return (
    <div className="card">
      <h2>Export</h2>
      <div className="form-row">
        <label>
          Arbeitsbereich
          <select value={workAreaId} onChange={(e) => setWorkAreaId(e.target.value)}>
            <option value="">Alle Arbeitsbereiche</option>
            {workAreas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="export-table">
          <tbody>
            {EXPORTS.map((item) => (
              <tr key={item.kind}>
                <td>
                  <strong>{item.label}</strong>
                  <div className="muted">{item.hint}</div>
                </td>
                <td className="actions">
                  <a className="button small" href={url(item.kind, 'csv')} download>
                    CSV
                  </a>
                  <a className="button small" href={url(item.kind, 'xlsx')} download>
                    Excel (XLSX)
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        CSV-Dateien sind für Excel mit deutschen Einstellungen vorbereitet (Semikolon,
        Dezimalkomma).
      </p>
    </div>
  );
}
