import {
  workAreaChannel,
  workstationChannel,
  type ArticleMatch,
  type Checkpoint,
  type CreateEntryResponse,
  type CreateManualEntryRequest,
  type DeleteEntryResponse,
  type Entry,
  type EntryListResponse,
} from '@inventur/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../api/client.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatEuro, formatNumber } from '../format.ts';
import { useConnectionStatus, useRealtimeEvents } from '../realtime/RealtimeProvider.tsx';
import { playDuplicateTone, playTone } from '../station/audio.ts';
import { useStation } from '../station/StationContext.tsx';
import { completionFor, moveSelection, suggestionCode } from './completion.ts';
import { EntryTable, type RowAction } from './EntryTable.tsx';
import { effectiveSelection, interpretKey, moveRowSelection } from './keyboard.ts';
import { ManualEntryDialog, type ManualEntryValues } from './ManualEntryDialog.tsx';
import { SerialQueue, type QueueOutcome } from './queue.ts';
import { useSuggestions } from './useSuggestions.ts';
import { randomId } from './uuid.ts';

interface Scan {
  input: string;
  requestId: string;
  articleId?: number;
}

/** A change of a line; without `entryId` it applies to the newest own line at that time. */
interface RowTask {
  action: RowAction;
  entryId: number | null;
}

type Task =
  | ({ kind: 'scan' } & Scan)
  | ({ kind: 'row' } & RowTask)
  | ({ kind: 'manual' } & CreateManualEntryRequest)
  | { kind: 'checkpoint'; afterEntryId: number | null }
  | { kind: 'delete_checkpoint'; checkpoint: Checkpoint };

type Feedback =
  | { kind: 'unique'; entry: Entry }
  | { kind: 'not_found'; input: string; fromPhone?: boolean }
  | { kind: 'phone'; result: 'unique' | 'ambiguous'; input: string; description: string | null }
  | { kind: 'updated'; entry: Entry }
  | { kind: 'deleted'; description: string; removedCheckpoints: number[] }
  | { kind: 'info'; message: string }
  | { kind: 'checkpoint'; checkpoint: Checkpoint }
  | { kind: 'error'; message: string; input?: string };

interface Choice {
  input: string;
  articles: ArticleMatch[];
  hasMore: boolean;
  index: number;
  settle: (articleId: number | null) => void;
}

/** Interval in which a queue paused by a network error is retried while connected. */
const RETRY_MS = 2000;

/** Errors after which the request is retried: the server was not reachable. */
function isTransient(error: unknown): boolean {
  return (
    !(error instanceof ApiRequestError) || error.code === 'network_error' || error.status >= 502
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));

/**
 * Entry view of a workstation in a work area: an always focused input for
 * scanners and keyboard, feedback (green, yellow, red) and the list of lines.
 */
export function CaptureView() {
  const { api, headers, state } = useStation();
  const workArea = state.workArea!;
  const connected = useConnectionStatus() === 'open';
  const hasEmployee = state.employees.length > 0;
  const enabled = connected && hasEmployee;

  const entries = useApiData<EntryListResponse>('/api/station/entries', {
    channels: [workAreaChannel(workArea.id)],
    filter: (event) => event.type === 'entry.changed' || event.type === 'checkpoint.changed',
    headers,
  });

  const [text, setText] = useState('');
  const [quantityDigits, setQuantityDigits] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** Original input of the open manual capture dialog, or null while it is closed. */
  const [manualInput, setManualInput] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useSuggestions(api, choice || quantityDigits !== null ? '' : text);
  const completion = choice || quantityDigits !== null ? null : completionFor(text, suggestions);

  const list = entries.data?.entries ?? [];
  const selection = effectiveSelection(list, selectedId, state.workstation.id);

  // The queue lives as long as the view; its handler is replaced after every render.
  const [queue] = useState(
    () => new SerialQueue<Task>(undefined, (q) => setPending(q.pending.length)),
  );
  const reloadEntries = entries.reload;
  // The newest own line may be newer than the loaded list, e.g. right after a scan.
  const lastCreatedId = useRef<number | null>(null);

  useEffect(() => {
    async function processScan(scan: Scan): Promise<QueueOutcome> {
      let response: CreateEntryResponse;
      try {
        response = await api.post<CreateEntryResponse>('/api/station/entries', scan);
      } catch (error) {
        if (isTransient(error)) return 'retry';
        setFeedback({ kind: 'error', input: scan.input, message: messageOf(error) });
        return 'done';
      }
      switch (response.result) {
        case 'unique':
          lastCreatedId.current = response.entry.id;
          setFeedback({ kind: 'unique', entry: response.entry });
          if (response.entry.duplicateCount > 0) playDuplicateTone();
          reloadEntries();
          return 'done';
        case 'not_found':
          setFeedback({ kind: 'not_found', input: scan.input });
          playTone();
          return 'done';
        case 'ambiguous': {
          setFeedback(null);
          const articleId = await new Promise<number | null>((settle) =>
            setChoice({ ...response, input: scan.input, index: 0, settle }),
          );
          setChoice(null);
          if (articleId === null) return 'done';
          return processScan({ ...scan, articleId });
        }
      }
    }

    async function processRow({ action, entryId }: RowTask): Promise<QueueOutcome> {
      const ownDefault = effectiveSelection(list, null, state.workstation.id);
      const target =
        entryId ??
        (lastCreatedId.current !== null && lastCreatedId.current > (ownDefault ?? 0)
          ? lastCreatedId.current
          : ownDefault);
      if (target === null) {
        setFeedback({ kind: 'error', message: 'Es ist keine Zeile ausgewählt.' });
        return 'done';
      }
      const url = `/api/station/entries/${target}`;
      try {
        if (action.type === 'delete') {
          const { removedCheckpoints } = await api.delete<DeleteEntryResponse>(url);
          if (lastCreatedId.current === target) lastCreatedId.current = null;
          const description = list.find((e) => e.id === target)?.description ?? 'Zeile';
          setFeedback({ kind: 'deleted', description, removedCheckpoints });
        } else {
          const body =
            action.type === 'set' ? { quantity: action.quantity } : { delta: action.delta };
          setFeedback({ kind: 'updated', entry: await api.patch<Entry>(url, body) });
        }
      } catch (error) {
        if (isTransient(error)) return 'retry';
        if (lastCreatedId.current === target) lastCreatedId.current = null;
        const gone = error instanceof ApiRequestError && error.code === 'not_found';
        setFeedback({
          kind: 'error',
          message: gone ? 'Die Zeile gibt es nicht mehr.' : messageOf(error),
        });
      }
      reloadEntries();
      return 'done';
    }

    async function processManual(task: Task & { kind: 'manual' }): Promise<QueueOutcome> {
      const { input, description, priceGross, serialNumber, requestId } = task;
      const request: CreateManualEntryRequest = {
        input,
        description,
        priceGross,
        serialNumber,
        requestId,
      };
      try {
        const entry = await api.post<Entry>('/api/station/entries/manual', request);
        lastCreatedId.current = entry.id;
        setFeedback({ kind: 'unique', entry });
        reloadEntries();
      } catch (error) {
        if (isTransient(error)) return 'retry';
        setFeedback({ kind: 'error', input: request.description, message: messageOf(error) });
      }
      return 'done';
    }

    async function processCheckpoint(afterEntryId: number | null): Promise<QueueOutcome> {
      try {
        const checkpoint = await api.post<Checkpoint>(
          '/api/station/checkpoints',
          afterEntryId === null ? {} : { afterEntryId },
        );
        setFeedback({ kind: 'checkpoint', checkpoint });
        reloadEntries();
      } catch (error) {
        if (isTransient(error)) return 'retry';
        setFeedback({ kind: 'error', message: messageOf(error) });
      }
      return 'done';
    }

    async function processDeleteCheckpoint(checkpoint: Checkpoint): Promise<QueueOutcome> {
      try {
        await api.delete(`/api/station/checkpoints/${checkpoint.id}`);
        setFeedback({ kind: 'info', message: `Checkpoint ${checkpoint.number} gelöscht.` });
        reloadEntries();
      } catch (error) {
        if (isTransient(error)) return 'retry';
        setFeedback({ kind: 'error', message: messageOf(error) });
      }
      return 'done';
    }

    queue.setHandler((task) => {
      switch (task.kind) {
        case 'scan':
          return processScan(task);
        case 'row':
          return processRow(task);
        case 'manual':
          return processManual(task);
        case 'checkpoint':
          return processCheckpoint(task.afterEntryId);
        case 'delete_checkpoint':
          return processDeleteCheckpoint(task.checkpoint);
      }
    });
  });

  // Scans of paired phones run through the same logic; the workstation shows their results too.
  useRealtimeEvents([workstationChannel(state.workstation.id)], (event) => {
    if (event.type !== 'phone_scan.result') return;
    if (event.result === 'not_found') {
      setFeedback({ kind: 'not_found', input: event.input, fromPhone: true });
      playTone();
      return;
    }
    if (event.duplicate) playDuplicateTone();
    if (event.entryId !== null) {
      lastCreatedId.current = event.entryId;
      // Like a scan at the workstation, the new line becomes the selected one.
      setSelectedId(null);
    }
    setFeedback({
      kind: 'phone',
      result: event.result,
      input: event.input,
      description: event.description,
    });
  });

  // Retry scans that failed because the server was unreachable.
  useEffect(() => {
    if (!connected) return;
    queue.resume();
    const timer = setInterval(() => queue.resume(), RETRY_MS);
    return () => clearInterval(timer);
  }, [connected, queue]);

  // Keep the input focused: typing or scanning anywhere on the page goes into it.
  useEffect(() => {
    if (enabled) inputRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditable(document.activeElement) || document.querySelector('[role="dialog"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length === 1 || event.key === 'Enter') inputRef.current?.focus();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, button, a, [role="dialog"]')) return;
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick);
    };
  }, [enabled]);

  function submit(scan: Omit<Scan, 'requestId'>) {
    queue.push({ kind: 'scan', ...scan, requestId: randomId() });
    setText('');
    // A new scan makes the shortcuts act on the newest own line again.
    setSelectedId(null);
    inputRef.current?.focus();
  }

  /** Opens the manual capture with the typed text or the last unknown input. */
  function openManual() {
    setQuantityDigits(null);
    setManualInput(text.trim() || (feedback?.kind === 'not_found' ? feedback.input : ''));
  }

  function submitManual(input: string, values: ManualEntryValues) {
    queue.push({ kind: 'manual', input, ...values, requestId: randomId() });
    setManualInput(null);
    setText('');
    setSelectedId(null);
  }

  /** A line chosen with the arrow keys or a click; without one, the shortcuts use the default. */
  const explicitSelection = selectedId !== null && selection === selectedId ? selectedId : null;

  /** Sets a checkpoint after the newest line, or after `afterEntryId` when inserted later. */
  function addCheckpoint(afterEntryId: number | null = null) {
    queue.push({ kind: 'checkpoint', afterEntryId });
    inputRef.current?.focus();
  }

  function changeRow(action: RowAction, entryId: number | null = null) {
    queue.push({ kind: 'row', action, entryId: entryId ?? explicitSelection });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const command = interpretKey({ text, quantityDigits, choiceOpen: choice !== null }, event.key);
    if (command.type !== 'none') event.preventDefault();
    switch (command.type) {
      case 'delete':
        return changeRow({ type: 'delete' });
      case 'increment':
        return changeRow({ type: 'delta', delta: 1 });
      case 'decrement':
        return changeRow({ type: 'delta', delta: -1 });
      case 'start_quantity':
        return setQuantityDigits('');
      case 'quantity_input':
        return setQuantityDigits(command.digits);
      case 'set_quantity':
        setQuantityDigits(null);
        return changeRow({ type: 'set', quantity: command.quantity });
      case 'invalid_quantity':
        return setFeedback({ kind: 'error', message: 'Die Menge muss mindestens 1 sein.' });
      case 'cancel_quantity':
        return setQuantityDigits(null);
      case 'select':
        return setSelectedId(moveRowSelection(list, selection, command.delta));
      case 'reset_selection':
        setSelectedId(null);
        return setFeedback(null);
      case 'manual':
        return openManual();
      case 'checkpoint':
        return addCheckpoint();
      case 'ignore':
        return;
      case 'none':
        break;
    }

    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        const input = text.trim();
        if (choice && input === '') {
          choice.settle(choice.articles[choice.index]!.id);
        } else if (input !== '') {
          submit({ input });
        }
        break;
      }
      case 'Tab':
        if (completion) {
          event.preventDefault();
          setText(completion);
        }
        break;
      case 'Escape':
        event.preventDefault();
        choice?.settle(null);
        setText('');
        setFeedback(null);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        if (choice) {
          event.preventDefault();
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          setChoice({
            ...choice,
            index: moveSelection(choice.index, delta, choice.articles.length),
          });
        }
        break;
    }
  }

  const tone = choice
    ? 'ambiguous'
    : feedback?.kind === 'unique' || feedback?.kind === 'not_found'
      ? feedback.kind
      : feedback?.kind === 'phone'
        ? feedback.result
        : feedback?.kind === 'error'
          ? 'not_found'
          : undefined;
  const quantityMode = quantityDigits !== null;
  const latestCheckpoint = entries.data?.checkpoints[0];
  const totals = entries.data?.totals;

  return (
    <section className="capture" aria-label="Erfassung">
      {!connected && (
        <div className="notice error capture-blocked" role="alert">
          Keine Verbindung zum Server. Die Eingabe ist gesperrt, bis die Verbindung wieder steht.
        </div>
      )}
      {connected && !hasEmployee && (
        <div className="notice warning capture-blocked" role="alert">
          Zum Erfassen muss mindestens ein Mitarbeiter angemeldet sein.
        </div>
      )}
      <div className={`capture-panel ${tone ?? ''}`} data-feedback={tone ?? 'none'}>
        <div className="capture-input-row">
          {quantityMode && <span className="quantity-label">Menge:</span>}
          <div className="capture-input">
            {!quantityMode && (
              <div className="ghost" aria-hidden>
                <span className="typed">{text}</span>
                {completion?.slice(text.length)}
              </div>
            )}
            <input
              ref={inputRef}
              value={quantityMode ? quantityDigits : text}
              disabled={!enabled}
              aria-label="Eingabe: EAN, Artikelnummer oder Bezeichnung"
              placeholder={
                quantityMode
                  ? 'Menge eingeben, Enter übernimmt, Esc bricht ab'
                  : 'Scannen oder EAN, Artikelnummer, Bezeichnung eingeben'
              }
              className={quantityMode ? 'quantity-mode' : undefined}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                if (quantityMode) return;
                if (text === '' && event.target.value !== '') setFeedback(null);
                setText(event.target.value);
              }}
              onKeyDown={onKeyDown}
            />
            {suggestions.length > 0 && !choice && (
              <ul className="suggestions" role="listbox" aria-label="Vorschläge">
                {suggestions.map((article) => (
                  <li key={article.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => submit({ input: text.trim(), articleId: article.id })}
                    >
                      <span>{article.description}</span>
                      <span className="code">{suggestionCode(article)}</span>
                      <span className="price">{formatEuro(article.priceGross)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="manual-button" disabled={!enabled} onClick={openManual}>
            Manuell erfassen
            <br />
            <span className="muted">F2</span>
          </button>
          <button
            type="button"
            className="manual-button"
            disabled={!enabled}
            onClick={() => addCheckpoint()}
            title="Checkpoint nach der neuesten Zeile setzen"
          >
            Checkpoint
            <br />
            <span className="muted">F3</span>
          </button>
          <div className="totals" aria-label="Summe im Bereich">
            <div className="totals-quantity">
              {totals ? formatNumber(totals.quantity) : '–'} <span>Stück</span>
            </div>
            <div className="muted">
              {totals ? formatNumber(totals.lines) : '–'} Zeilen ·{' '}
              {totals ? formatEuro(totals.grossValue) : '–'}
            </div>
            {latestCheckpoint && (
              <div className="since-checkpoint">
                seit Checkpoint {latestCheckpoint.number}:{' '}
                <strong>{formatNumber(entries.data!.sinceLastCheckpoint)} Stück</strong>
              </div>
            )}
          </div>
        </div>

        <div className="capture-feedback" role="status">
          {pending > 1 && <span className="muted">{pending} Scans in Bearbeitung … </span>}
          {choice && <ChoiceList choice={choice} onSelect={(id) => choice.settle(id)} />}
          {!choice && feedback?.kind === 'unique' && (
            <span>
              <strong>{feedback.entry.description}</strong> ·{' '}
              {formatEuro(feedback.entry.priceGross)}{' '}
              {feedback.entry.isManual ? 'manuell erfasst' : 'erfasst'}
              {feedback.entry.duplicateCount > 0 && (
                <span className="duplicate-hint">
                  {' '}
                  – Hinweis: Dieser Artikel wurde bereits{' '}
                  {feedback.entry.duplicateCount === 1
                    ? 'einmal'
                    : `${feedback.entry.duplicateCount}-mal`}{' '}
                  erfasst.
                </span>
              )}
            </span>
          )}
          {!choice && feedback?.kind === 'not_found' && (
            <span>
              <strong>Kein Artikel gefunden</strong> für „{feedback.input}“
              {feedback.fromPhone && ' (vom Handy)'}.{' '}
              <button type="button" className="small primary" onClick={openManual}>
                Manuell erfassen (F2)
              </button>
            </span>
          )}
          {!choice && feedback?.kind === 'error' && (
            <span>
              {feedback.input !== undefined && (
                <strong>„{feedback.input}“ wurde nicht erfasst: </strong>
              )}
              {feedback.message}
            </span>
          )}
          {!choice && feedback?.kind === 'updated' && (
            <span>
              Menge von <strong>{feedback.entry.description}</strong> ist jetzt{' '}
              <strong>{formatNumber(feedback.entry.quantity)}</strong>.
            </span>
          )}
          {!choice && feedback?.kind === 'info' && <span>{feedback.message}</span>}
          {!choice && feedback?.kind === 'phone' && feedback.result === 'unique' && (
            <span>
              Vom Handy erfasst: <strong>{feedback.description}</strong>
            </span>
          )}
          {!choice && feedback?.kind === 'phone' && feedback.result === 'ambiguous' && (
            <span>
              Vom Handy: <strong>Mehrere Artikel</strong> passen zu „{feedback.input}“. Die Auswahl
              erfolgt auf dem Handy.
            </span>
          )}
          {!choice && feedback?.kind === 'checkpoint' && (
            <span>
              <strong>Checkpoint {feedback.checkpoint.number} gesetzt:</strong>{' '}
              {feedback.checkpoint.number > 1 &&
                `${formatNumber(feedback.checkpoint.sinceLast)} Stück seit Checkpoint ${feedback.checkpoint.number - 1}, `}
              {formatNumber(feedback.checkpoint.sinceStart)} Stück seit Beginn.
            </span>
          )}
          {!choice && feedback?.kind === 'deleted' && (
            <span>
              <strong>Zeile gelöscht:</strong> {feedback.description}
              {feedback.removedCheckpoints.map((number) => (
                <span key={number} className="duplicate-hint">
                  {' '}
                  – Checkpoint {number} wurde entfernt, weil sein Abschnitt leer war.
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {manualInput !== null && (
        <ManualEntryDialog
          input={manualInput}
          onSubmit={(values) => submitManual(manualInput, values)}
          onCancel={() => setManualInput(null)}
        />
      )}
      <ErrorNotice error={entries.error} />
      {entries.data && (
        <EntryTable
          entries={list}
          checkpoints={entries.data.checkpoints}
          sinceLastCheckpoint={entries.data.sinceLastCheckpoint}
          selectedId={selection}
          disabled={!enabled}
          onSelect={(id) => {
            setSelectedId(id);
            inputRef.current?.focus();
          }}
          onAction={(id, action) => {
            changeRow(action, id);
            inputRef.current?.focus();
          }}
          onInsertCheckpoint={(entryId) => addCheckpoint(entryId)}
          onDeleteCheckpoint={(checkpoint) => {
            queue.push({ kind: 'delete_checkpoint', checkpoint });
            inputRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function ChoiceList({ choice, onSelect }: { choice: Choice; onSelect: (id: number) => void }) {
  return (
    <div>
      <p style={{ margin: '0 0 0.5rem' }}>
        <strong>Mehrere Artikel</strong> passen zu „{choice.input}“. Auswahl mit ↑/↓ und Enter, Esc
        bricht ab.
        {choice.hasMore && ' Es werden nur die ersten 20 angezeigt.'}
      </p>
      <ul className="choices" role="listbox" aria-label="Artikelauswahl">
        {choice.articles.map((article, index) => (
          <li key={article.id} role="option" aria-selected={index === choice.index}>
            <button type="button" tabIndex={-1} onClick={() => onSelect(article.id)}>
              <span>{article.description}</span>
              <span className="code">
                {article.ean ?? ''} {article.articleNumbers.join(', ')}
              </span>
              <span className="price">{formatEuro(article.priceGross)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
