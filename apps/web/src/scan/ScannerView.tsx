import type {
  ArticleMatch,
  CreateEntryResponse,
  DeleteEntryResponse,
  Entry,
} from '@inventur/shared';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { ApiRequestError, type Api } from '../api/client.ts';
import { SerialQueue } from '../capture/queue.ts';
import { randomId } from '../capture/uuid.ts';
import { formatEuro, formatNumber } from '../format.ts';
import { unlockAudio } from '../station/audio.ts';
import { startCamera, type CameraScanner } from './camera.ts';
import { ScanDebouncer } from './debounce.ts';
import { loadHoldMode, saveHoldMode } from './holdMode.ts';
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
 * The phone as a camera scanner, filling the screen without scrolling: the
 * camera picture with the result on top and a bar with the controls. Codes
 * are captured for the paired workstation; either continuously or, in hold
 * mode, only while the scan button is held.
 */
export function ScannerView({ api, notice }: { api: Api; notice?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scanner, setScanner] = useState<CameraScanner | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const [holdMode, setHoldMode] = useState(loadHoldMode);
  const [holding, setHolding] = useState(false);
  const [queue] = useState(() => new SerialQueue<Scan>());
  const [debouncer] = useState(() => new ScanDebouncer());

  // The camera callback outlives renders, so it reads the current mode from refs.
  const accepting = useRef({ holdMode, holding });
  useEffect(() => {
    accepting.current = { holdMode, holding };
  });

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
      const started = await startCamera(
        videoRef.current!,
        (detected) => {
          const { holdMode: hold, holding: held } = accepting.current;
          if (hold && !held) return;
          if (!debouncer.accept(detected, performance.now())) return;
          capture(detected);
          // In hold mode, a press reads at most one code; the next needs a new press.
          if (hold) {
            accepting.current = { ...accepting.current, holding: false };
            setHolding(false);
          }
        },
        { frame: frameRect },
      );
      setScanner(started);
    } catch (error) {
      setCameraError(messageOf(error));
    } finally {
      setStarting(false);
    }
  }

  /** The scan frame relative to the video, so only codes inside it are read. */
  function frameRect() {
    const video = videoRef.current?.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!video || !frame) return null;
    return {
      x: frame.left - video.left,
      y: frame.top - video.top,
      width: frame.width,
      height: frame.height,
    };
  }

  function stop() {
    scanner?.stop();
    setScanner(null);
  }

  function toggleHoldMode() {
    saveHoldMode(!holdMode);
    setHoldMode(!holdMode);
  }

  function press(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Every press may read the same code again.
    debouncer.reset();
    accepting.current = { holdMode, holding: true };
    setHolding(true);
  }

  function release() {
    accepting.current = { holdMode, holding: false };
    setHolding(false);
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
    setTyping(false);
  }

  const closeButton = (
    <button
      type="button"
      className="result-close"
      aria-label="Ergebnis schließen"
      onClick={() => setResult(null)}
    >
      ×
    </button>
  );

  return (
    <div className="scanner">
      <div className={`camera ${scanner ? 'running' : ''}`}>
        <video ref={videoRef} playsInline muted aria-label="Kamerabild" />
        <div
          ref={frameRef}
          className={`camera-frame ${!holdMode || holding ? 'active' : ''}`}
          aria-hidden
        />
        {notice && <div className="scan-notice">{notice}</div>}
        {scanner && (
          <button type="button" className="small camera-off" onClick={stop}>
            Kamera ausschalten
          </button>
        )}
        {!scanner && (
          <div className="camera-placeholder">
            <button
              type="button"
              className="primary camera-start"
              disabled={starting}
              onClick={() => void start()}
            >
              {starting ? 'Kamera wird gestartet …' : 'Kamera starten'}
            </button>
            {cameraError && (
              <div className="notice error" role="alert">
                {cameraError}
              </div>
            )}
          </div>
        )}

        <div className="scan-overlay" aria-live="polite">
          {result?.kind === 'unique' && (
            <div className="result unique" data-result="unique">
              {closeButton}
              <div className="result-title">{result.entry.description}</div>
              <div className="result-meta">
                <span className="code">{result.entry.ean ?? result.entry.input}</span>
                <strong>{formatEuro(result.entry.priceGross)}</strong>
              </div>
              {result.entry.duplicateCount > 0 && (
                <div className="duplicate-hint">Dieser Artikel wurde schon erfasst.</div>
              )}
              <div className="result-actions">
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
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => void change(result.entry, 'delete')}
                >
                  Löschen
                </button>
              </div>
            </div>
          )}
          {result?.kind === 'ambiguous' && (
            <div className="result ambiguous" data-result="ambiguous">
              {closeButton}
              <div className="result-title">Mehrere Artikel passen – bitte antippen:</div>
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
            </div>
          )}
          {result?.kind === 'not_found' && (
            <div className="result not_found" data-result="not_found">
              {closeButton}
              <div className="result-title">Artikel unbekannt</div>
              <div>Bitte an der Station manuell erfassen.</div>
              <div className="code">{result.input}</div>
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
          {typing && (
            <form className="result code-form" onSubmit={submitCode}>
              <label htmlFor="manual-code">Code</label>
              <div className="row">
                <input
                  id="manual-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
                <button type="submit" className="primary">
                  Erfassen
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="scan-controls">
        <button type="button" aria-pressed={typing} onClick={() => setTyping(!typing)}>
          Code eintippen
        </button>
        {holdMode ? (
          <button
            type="button"
            className={`hold-button ${holding ? 'active' : ''}`}
            disabled={!scanner}
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onContextMenu={(event) => event.preventDefault()}
          >
            {holding ? 'Scannt …' : 'Zum Scannen halten'}
          </button>
        ) : (
          <span className="scan-mode-hint">{scanner ? 'Scannt automatisch' : ''}</span>
        )}
        <button type="button" aria-pressed={holdMode} onClick={toggleHoldMode}>
          {holdMode ? 'Modus: Taste' : 'Modus: Auto'}
        </button>
      </div>
    </div>
  );
}
