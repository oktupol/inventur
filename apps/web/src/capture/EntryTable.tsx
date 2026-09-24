import type { Checkpoint, Entry } from '@inventur/shared';
import { useEffect, useState, type MouseEvent } from 'react';
import { formatEuro, formatNumber, formatTime } from '../format.ts';
import { buildRows, insertionTargets } from './rows.ts';

export type RowAction =
  { type: 'delta'; delta: 1 | -1 } | { type: 'set'; quantity: number } | { type: 'delete' };

export interface EntryTableProps {
  entries: readonly Entry[];
  /** Newest first; shown as separator rows between the sections. */
  checkpoints?: readonly Checkpoint[];
  /** Pieces after the newest checkpoint, shown live above it. */
  sinceLastCheckpoint?: number;
  /** The line the shortcuts act on. */
  selectedId?: number | null;
  disabled?: boolean;
  onSelect?: (id: number) => void;
  onAction?: (id: number, action: RowAction) => void;
  onDeleteCheckpoint?: (checkpoint: Checkpoint) => void;
  /** Inserts a checkpoint after a line; offered by a button that appears on mouseover. */
  onInsertCheckpoint?: (entryId: number) => void;
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
  checkpoints = [],
  sinceLastCheckpoint = 0,
  selectedId = null,
  disabled = false,
  onSelect,
  onAction,
  onDeleteCheckpoint,
  onInsertCheckpoint,
}: EntryTableProps) {
  // Which edge of which line the mouse is near; the insert button appears there.
  const [hover, setHover] = useState<{ id: number; edge: 'top' | 'bottom' } | null>(null);

  function trackHover(event: MouseEvent<HTMLTableRowElement>, id: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
    if (hover?.id !== id || hover.edge !== edge) setHover({ id, edge });
  }

  useEffect(() => {
    if (selectedId === null) return;
    document
      .querySelector(`[data-entry-id="${selectedId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  if (entries.length === 0 && checkpoints.length === 0) {
    return <p className="muted">In diesem Bereich wurde noch nichts erfasst.</p>;
  }
  const columns = onAction ? 8 : 7;
  const rows = buildRows(entries, checkpoints, sinceLastCheckpoint);
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
          {rows.map((row, index) => {
            if (row.type === 'since') {
              return (
                <tr key="since" className="since-checkpoint-row">
                  <td colSpan={columns}>
                    Seit Checkpoint {row.number}:{' '}
                    <strong>{formatNumber(row.quantity)} Stück</strong>
                  </td>
                </tr>
              );
            }
            if (row.type === 'checkpoint') {
              const { checkpoint } = row;
              return (
                <tr key={`checkpoint-${checkpoint.id}`} className="checkpoint-row">
                  <td colSpan={columns}>
                    <strong>Checkpoint {checkpoint.number}</strong> ·{' '}
                    {formatTime(checkpoint.createdAt)}
                    {checkpoint.workstation && ` · ${checkpoint.workstation.name}`} ·{' '}
                    {checkpoint.number > 1 &&
                      `${formatNumber(checkpoint.sinceLast)} Stück seit Checkpoint ${checkpoint.number - 1} · `}
                    {formatNumber(checkpoint.sinceStart)} Stück seit Beginn
                    {onDeleteCheckpoint && (
                      <button
                        type="button"
                        className="small checkpoint-delete"
                        disabled={disabled}
                        aria-label={`Checkpoint ${checkpoint.number} löschen`}
                        onClick={() => onDeleteCheckpoint(checkpoint)}
                      >
                        Löschen
                      </button>
                    )}
                  </td>
                </tr>
              );
            }
            const { entry } = row;
            const targets = insertionTargets(rows, index);
            const insertButton = (edge: 'top' | 'bottom') => {
              const target = targets[edge];
              if (!onInsertCheckpoint || target === null) return null;
              const shown = hover?.id === entry.id && hover.edge === edge;
              return (
                <button
                  type="button"
                  className={`small insert-checkpoint ${edge} ${shown ? 'shown' : ''}`}
                  disabled={disabled}
                  title="Checkpoint an dieser Stelle einfügen"
                  aria-label={`Checkpoint nach Zeile ${
                    entries.find((e) => e.id === target)?.description ?? ''
                  } einfügen`}
                  data-after-entry={target}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInsertCheckpoint(target);
                  }}
                >
                  + Checkpoint
                </button>
              );
            };
            return (
              <tr
                key={entry.id}
                data-entry-id={entry.id}
                className={entry.id === selectedId ? 'selected' : undefined}
                aria-selected={entry.id === selectedId}
                onClick={() => onSelect?.(entry.id)}
                onMouseMove={(event) => trackHover(event, entry.id)}
                onMouseLeave={() => setHover(null)}
              >
                <td className="muted time-cell">
                  {formatTime(entry.createdAt)}
                  {insertButton('top')}
                  {insertButton('bottom')}
                </td>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
