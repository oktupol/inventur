import type { Entry } from '@inventur/shared';
import { useEffect, useState } from 'react';
import { formatEuro, formatNumber, formatTime } from '../format.ts';

export type RowAction =
  { type: 'delta'; delta: 1 | -1 } | { type: 'set'; quantity: number } | { type: 'delete' };

export interface EntryTableProps {
  entries: readonly Entry[];
  /** The line the shortcuts act on. */
  selectedId?: number | null;
  disabled?: boolean;
  onSelect?: (id: number) => void;
  onAction?: (id: number, action: RowAction) => void;
}

/** Quantity that can be edited directly; Enter or leaving the field applies it. */
function QuantityField({
  quantity,
  disabled,
  onCommit,
}: {
  quantity: number;
  disabled: boolean;
  onCommit: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (Number.isInteger(value) && value >= 1 && value !== quantity) onCommit(value);
  }

  return (
    <input
      className="quantity-field"
      type="number"
      min={1}
      inputMode="numeric"
      aria-label="Menge"
      disabled={disabled}
      value={draft ?? String(quantity)}
      onFocus={(event) => {
        setDraft(String(quantity));
        event.target.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** The lines of a work area, newest first, with controls for quantity and deletion. */
export function EntryTable({
  entries,
  selectedId = null,
  disabled = false,
  onSelect,
  onAction,
}: EntryTableProps) {
  useEffect(() => {
    if (selectedId === null) return;
    document
      .querySelector(`[data-entry-id="${selectedId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

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
            {onAction && <th />}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              data-entry-id={entry.id}
              className={entry.id === selectedId ? 'selected' : undefined}
              aria-selected={entry.id === selectedId}
              onClick={() => onSelect?.(entry.id)}
            >
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
              <td className="number">
                {onAction ? (
                  <span className="quantity-controls">
                    <button
                      type="button"
                      className="small"
                      aria-label="Menge verringern"
                      disabled={disabled || entry.quantity <= 1}
                      onClick={() => onAction(entry.id, { type: 'delta', delta: -1 })}
                    >
                      −
                    </button>
                    <QuantityField
                      quantity={entry.quantity}
                      disabled={disabled}
                      onCommit={(quantity) => onAction(entry.id, { type: 'set', quantity })}
                    />
                    <button
                      type="button"
                      className="small"
                      aria-label="Menge erhöhen"
                      disabled={disabled}
                      onClick={() => onAction(entry.id, { type: 'delta', delta: 1 })}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  formatNumber(entry.quantity)
                )}
              </td>
              <td className="number">{formatEuro(entry.priceGross)}</td>
              <td>{entry.workstation.name}</td>
              {onAction && (
                <td className="actions">
                  <button
                    type="button"
                    className="small"
                    disabled={disabled}
                    onClick={() => onAction(entry.id, { type: 'delete' })}
                  >
                    Löschen
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
