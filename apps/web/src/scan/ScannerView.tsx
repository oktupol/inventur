import type {
  ArticleMatch,
  CreateEntryResponse,
  DeleteEntryResponse,
  Entry,
} from '@inventur/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, type Api } from '../api/client.ts';
import { SerialQueue } from '../capture/queue.ts';
import { randomId } from '../capture/uuid.ts';
import { formatEuro, formatNumber } from '../format.ts';
import { unlockAudio } from '../station/audio.ts';
import { startCamera, type CameraScanner } from './camera.ts';
import { ScanDebouncer } from './debounce.ts';
import { signal } from './signal.ts';

type Result =
  | { kind: 'unique'; entry: Entry }
  | { kind: 'ambiguous'; input: string; articles: ArticleMatch[] }
  | { kind: 'not_found'; input: string }
  | { kind: 'deleted'; description: string }
  | { kind: 'error'; message: string };

interface Scan {
  input: string;
  articleId?: number;
  requestId: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The phone as a camera scanner: detected codes are captured for the paired
 * workstation. The result shows the article with +, − and Löschen for the
 * line of this scan, a choice for ambiguous codes, or a hint for unknown ones.
 */
export function ScannerView({ api }: { api: Api }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanner, setScanner] = useState<CameraScanner | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [queue] = useState(() => new SerialQueue<Scan>());
  const [debouncer] = useState(() => new ScanDebouncer());

  useEffect(() => {
    queue.setHandler(async (scan) => {
      try {
        const response = await api.post<CreateEntryResponse>('/api/scan/entries', scan);
        signal(response.result);
        setResult(
          response.result === 'unique'
            ? { kind: 'unique', entry: response.entry }
            : response.result === 'ambiguous'
              ? { kind: 'ambiguous', input: scan.input, articles: response.articles }
              : { kind: 'not_found', input: scan.input },
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'network_error') return 'retry';
        signal('not_found');
        setResult({ kind: 'error', message: messageOf(error) });
      }
      return 'done';
    });
  });

  // A queue paused by a lost connection is retried regularly.
  useEffect(() => {
    const timer = setInterval(() => queue.resume(), 2000);
    return () => clearInterval(timer);
  }, [queue]);

  useEffect(() => () => scanner?.stop(), [scanner]);

  function capture(input: string, articleId?: number) {
    queue.push({ input, articleId, requestId: randomId() });
  }

  async function start() {
    unlockAudio();
    setCameraError(undefined);
    setStarting(true);
    try {
      const started = await startCamera(videoRef.current!, (detected) => {
        if (debouncer.accept(detected, performance.now())) capture(detected);
      });
      setScanner(started);
    } catch (error) {
      setCameraError(messageOf(error));
    } finally {
      setStarting(false);
    }
  }

  function stop() {
    scanner?.stop();
    setScanner(null);
  }

  async function change(entry: Entry, action: 'plus' | 'minus' | 'delete') {
    setBusy(true);
    try {
      const url = `/api/scan/entries/${entry.id}`;
      if (action === 'delete') {
        await api.delete<DeleteEntryResponse>(url);
        setResult({ kind: 'deleted', description: entry.description });
      } else {
        const updated = await api.patch<Entry>(url, { delta: action === 'plus' ? 1 : -1 });
        setResult({ kind: 'unique', entry: updated });
      }
    } catch (error) {
      setResult({ kind: 'error', message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    if (code.trim() === '') return;
    unlockAudio();
    capture(code.trim());
    setCode('');
  }

  return (
    <div className="scanner">
      <div className={`camera ${scanner ? 'running' : ''}`}>
        <video ref={videoRef} playsInline muted aria-label="Kamerabild" />
        {scanner && <div className="camera-frame" aria-hidden />}
        {!scanner && (
          <button
            type="button"
            className="primary camera-start"
            disabled={starting}
            onClick={() => void start()}
          >
            {starting ? 'Kamera wird gestartet …' : 'Kamera starten'}
          </button>
        )}
      </div>
      {cameraError && (
        <div className="notice error" role="alert">
          {cameraError}
        </div>
      )}
      {scanner && (
        <button type="button" className="small" onClick={stop}>
          Kamera ausschalten
        </button>
      )}

      <div className="scan-result" aria-live="polite">
        {result?.kind === 'unique' && (
          <div className="result unique" data-result="unique">
            <div className="result-title">{result.entry.description}</div>
            <div className="muted code">{result.entry.ean ?? result.entry.input}</div>
            <div className="result-price">{formatEuro(result.entry.priceGross)}</div>
            <div className="result-quantity">
              <button
                type="button"
                aria-label="Menge verringern"
                disabled={busy || result.entry.quantity <= 1}
                onClick={() => void change(result.entry, 'minus')}
              >
                −
              </button>
              <span aria-label="Menge">{formatNumber(result.entry.quantity)}</span>
              <button
                type="button"
                aria-label="Menge erhöhen"
                disabled={busy}
                onClick={() => void change(result.entry, 'plus')}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void change(result.entry, 'delete')}
            >
              Löschen
            </button>
            {result.entry.duplicateCount > 0 && (
              <p className="duplicate-hint">Hinweis: Dieses Einzelstück wurde schon erfasst.</p>
            )}
          </div>
        )}
        {result?.kind === 'ambiguous' && (
          <div className="result ambiguous" data-result="ambiguous">
            <div className="result-title">Mehrere Artikel passen</div>
            <p>Bitte den richtigen Artikel antippen:</p>
            <ul className="choices" aria-label="Artikelauswahl">
              {result.articles.map((article) => (
                <li key={article.id}>
                  <button type="button" onClick={() => capture(result.input, article.id)}>
                    <span>{article.description}</span>
                    <span className="price">{formatEuro(article.priceGross)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setResult(null)}>
              Abbrechen
            </button>
          </div>
        )}
        {result?.kind === 'not_found' && (
          <div className="result not_found" data-result="not_found">
            <div className="result-title">Artikel unbekannt</div>
            <p>Bitte an der Station manuell erfassen.</p>
            <p className="muted code">{result.input}</p>
          </div>
        )}
        {result?.kind === 'deleted' && (
          <div className="result" data-result="deleted">
            Zeile gelöscht: {result.description}
          </div>
        )}
        {result?.kind === 'error' && (
          <div className="result not_found" data-result="error" role="alert">
            {result.message}
          </div>
        )}
      </div>

      <form className="code-form" onSubmit={submitCode}>
        <label htmlFor="manual-code">Code eintippen</label>
        <div className="row">
          <input
            id="manual-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="text"
            autoComplete="off"
          />
          <button type="submit">Erfassen</button>
        </div>
      </form>
    </div>
  );
}
