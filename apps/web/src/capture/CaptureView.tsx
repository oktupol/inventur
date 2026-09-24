import {
  workAreaChannel,
  type ArticleMatch,
  type CreateEntryResponse,
  type Entry,
  type EntryListResponse,
} from '@inventur/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../api/client.ts';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatEuro, formatNumber } from '../format.ts';
import { useConnectionStatus } from '../realtime/RealtimeProvider.tsx';
import { playTone } from '../station/audio.ts';
import { useStation } from '../station/StationContext.tsx';
import { completionFor, matchedText, moveSelection } from './completion.ts';
import { EntryTable, type RowAction } from './EntryTable.tsx';
import { effectiveSelection, interpretKey, moveRowSelection } from './keyboard.ts';
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

type Task = ({ kind: 'scan' } & Scan) | ({ kind: 'row' } & RowTask);

type Feedback =
  | { kind: 'unique'; entry: Entry }
  | { kind: 'not_found'; input: string }
  | { kind: 'updated'; entry: Entry }
  | { kind: 'deleted'; description: string }
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
          await api.delete(url);
          if (lastCreatedId.current === target) lastCreatedId.current = null;
          const description = list.find((e) => e.id === target)?.description ?? 'Zeile';
          setFeedback({ kind: 'deleted', description });
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

    queue.setHandler((task) => (task.kind === 'scan' ? processScan(task) : processRow(task)));
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

  function changeRow(action: RowAction, entryId: number | null = null) {
    const explicit =
      entryId ?? (selectedId !== null && selection === selectedId ? selectedId : null);
    queue.push({ kind: 'row', action, entryId: explicit });
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
      : feedback?.kind === 'error'
        ? 'not_found'
        : undefined;
  const quantityMode = quantityDigits !== null;
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
                      <span className="code">{matchedText(article)}</span>
                      <span className="price">{formatEuro(article.priceGross)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="totals" aria-label="Summe im Bereich">
            <div className="totals-quantity">
              {totals ? formatNumber(totals.quantity) : '–'} <span>Stück</span>
            </div>
            <div className="muted">
              {totals ? formatNumber(totals.lines) : '–'} Zeilen ·{' '}
              {totals ? formatEuro(totals.grossValue) : '–'}
            </div>
          </div>
        </div>

        <div className="capture-feedback" role="status">
          {pending > 1 && <span className="muted">{pending} Scans in Bearbeitung … </span>}
          {choice && <ChoiceList choice={choice} onSelect={(id) => choice.settle(id)} />}
          {!choice && feedback?.kind === 'unique' && (
            <span>
              <strong>{feedback.entry.description}</strong> ·{' '}
              {formatEuro(feedback.entry.priceGross)} erfasst
              {feedback.entry.duplicateCount > 0 && (
                <span className="duplicate-hint">
                  {' '}
                  – Hinweis: Dieses Einzelstück wurde bereits{' '}
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
              <strong>Kein Artikel gefunden</strong> für „{feedback.input}“.
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
          {!choice && feedback?.kind === 'deleted' && (
            <span>
              <strong>Zeile gelöscht:</strong> {feedback.description}
            </span>
          )}
        </div>
      </div>

      <ErrorNotice error={entries.error} />
      {entries.data && (
        <EntryTable
          entries={list}
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
