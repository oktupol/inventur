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
import { EntryTable } from './EntryTable.tsx';
import { SerialQueue, type QueueOutcome } from './queue.ts';
import { useSuggestions } from './useSuggestions.ts';
import { randomId } from './uuid.ts';

interface Scan {
  input: string;
  requestId: string;
  articleId?: number;
}

type Feedback =
  | { kind: 'unique'; entry: Entry }
  | { kind: 'not_found'; input: string }
  | { kind: 'error'; input: string; message: string };

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useSuggestions(api, choice ? '' : text);
  const completion = choice ? null : completionFor(text, suggestions);

  // The queue lives as long as the view; its handler always uses the latest render's values.
  const handle = useRef<(scan: Scan) => Promise<QueueOutcome>>(async () => 'retry');
  const [queue] = useState(
    () =>
      new SerialQueue<Scan>(
        (scan) => handle.current(scan),
        () => setPending(queue.pending.length),
      ),
  );
  const reloadEntries = entries.reload;

  useEffect(() => {
    handle.current = async function process(scan: Scan): Promise<QueueOutcome> {
      let response: CreateEntryResponse;
      try {
        response = await api.post<CreateEntryResponse>('/api/station/entries', scan);
      } catch (error) {
        if (isTransient(error)) return 'retry';
        setFeedback({
          kind: 'error',
          input: scan.input,
          message: error instanceof Error ? error.message : String(error),
        });
        return 'done';
      }
      switch (response.result) {
        case 'unique':
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
          return process({ ...scan, articleId });
        }
      }
    };
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
    queue.push({ ...scan, requestId: randomId() });
    setText('');
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

  const tone = choice ? 'ambiguous' : feedback?.kind === 'error' ? 'not_found' : feedback?.kind;
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
          <div className="capture-input">
            <div className="ghost" aria-hidden>
              <span className="typed">{text}</span>
              {completion?.slice(text.length)}
            </div>
            <input
              ref={inputRef}
              value={text}
              disabled={!enabled}
              aria-label="Eingabe: EAN, Artikelnummer oder Bezeichnung"
              placeholder="Scannen oder EAN, Artikelnummer, Bezeichnung eingeben"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
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
              <strong>„{feedback.input}“ wurde nicht erfasst:</strong> {feedback.message}
            </span>
          )}
        </div>
      </div>

      <ErrorNotice error={entries.error} />
      {entries.data && <EntryTable entries={entries.data.entries} />}
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
