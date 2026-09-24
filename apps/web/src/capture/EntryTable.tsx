import type { Entry } from '@inventur/shared';
import { formatEuro, formatNumber, formatTime } from '../format.ts';

export interface EntryTableProps {
  entries: readonly Entry[];
}

/** The lines of a work area, newest first. */
export function EntryTable({ entries }: EntryTableProps) {
  if (entries.length === 0) {
    return <p className="muted">In diesem Bereich wurde noch nichts erfasst.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="entries">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Bezeichnung</th>
            <th>EAN / Artikelnummer</th>
            <th>Seriennummer</th>
            <th className="number">Menge</th>
            <th className="number">Preis brutto</th>
            <th>Station</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} data-entry-id={entry.id}>
              <td className="muted">{formatTime(entry.createdAt)}</td>
              <td>
                {entry.description}
                {entry.isManual && <span className="badge manual">manuell</span>}
                {entry.duplicateCount > 0 && (
                  <span
                    className="badge duplicate"
                    title="Einzelstück: Dieser Artikel wurde in der Inventur mehrfach erfasst."
                  >
                    mehrfach erfasst
                  </span>
                )}
              </td>
              <td className="code">{entry.ean ?? entry.input}</td>
              <td>{entry.serialNumber ?? ''}</td>
              <td className="number">{formatNumber(entry.quantity)}</td>
              <td className="number">{formatEuro(entry.priceGross)}</td>
              <td>{entry.workstation.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
