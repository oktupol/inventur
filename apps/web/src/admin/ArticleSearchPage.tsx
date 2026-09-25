import type {
  FoundArticle,
  FoundEntry,
  Stocktake,
  StocktakeArticleDetail,
  StocktakeArticleSearchResponse,
  StocktakeMatchField,
} from '@inventur/shared';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatDateTime, formatEuro, formatNumber } from '../format.ts';
import { NoActiveStocktake, useActiveStocktake } from './ActiveStocktake.tsx';
import { AuditLogTable } from './AuditLogPage.tsx';
import { Tile } from './StatisticsPage.tsx';

const MATCH_LABELS: Record<StocktakeMatchField, string> = {
  ean: 'EAN',
  article_number: 'Artikelnummer',
  description: 'Bezeichnung',
  serial_number: 'Seriennummer',
  input: 'Eingabe',
};

/** Delay after typing before searching. */
const SEARCH_DELAY_MS = 250;

const liveOptions = {
  channels: ['admin'] as const,
  filter: (event: { type: string }) => event.type === 'entry.changed',
  throttleMs: 1000,
};

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function difference(article: FoundArticle): string {
  if (article.expectedQuantity === null) return '–';
  const value = article.countedQuantity - article.expectedQuantity;
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function EntryList({
  entries,
  showArticle,
}: {
  entries: readonly FoundEntry[];
  showArticle?: boolean;
}) {
  if (entries.length === 0) return <p className="muted">Keine Zeilen erfasst.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            {showArticle && <th>Bezeichnung</th>}
            <th>Arbeitsbereich</th>
            <th>EAN / Eingabe</th>
            <th>Seriennummer</th>
            <th className="number">Menge</th>
            <th className="number">Preis brutto</th>
            <th>Station</th>
            <th>Mitarbeiter</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDateTime(entry.createdAt)}</td>
              {showArticle && <td>{entry.description}</td>}
              <td>{entry.workArea.name}</td>
              <td className="code">{entry.code ?? ''}</td>
              <td>{entry.serialNumber ?? ''}</td>
              <td className="number">{formatNumber(entry.quantity)}</td>
              <td className="number">{formatEuro(entry.priceGross)}</td>
              <td>{entry.workstation.name}</td>
              <td>{entry.employees.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArticleDetail({ base, articleId }: { base: string; articleId: number }) {
  const detail = useApiData<StocktakeArticleDetail>(`${base}/articles/${articleId}`, liveOptions);
  const data = detail.data;
  return (
    <div className="card">
      <ErrorNotice error={detail.error} />
      {data && (
        <>
          <h2>{data.article.description}</h2>
          <p className="muted">
            {[
              data.article.ean && `EAN ${data.article.ean}`,
              data.article.articleNumbers.length > 0 &&
                `Artikelnummer ${data.article.articleNumbers.join(', ')}`,
              data.article.category,
              data.article.priceGross && formatEuro(data.article.priceGross),
            ]
              .filter(Boolean)
              .join(' · ')}
            {!data.article.inMasterData && ' · nicht mehr in den Stammdaten'}
          </p>
          <div className="stats">
            <Tile
              label="Soll"
              value={
                data.article.expectedQuantity === null
                  ? '–'
                  : formatNumber(data.article.expectedQuantity)
              }
            />
            <Tile label="Ist" value={formatNumber(data.article.countedQuantity)} />
            <Tile label="Differenz" value={difference(data.article)} />
            <Tile label="Zeilen" value={formatNumber(data.article.lines)} />
          </div>
          <h3>Erfasste Zeilen</h3>
          <EntryList entries={data.entries} />
          <h3>Änderungen</h3>
          <AuditLogTable entries={data.auditLog} />
        </>
      )}
    </div>
  );
}

/** Search for articles in a stocktake: where they were captured, by whom, and what changed. */
function ArticleSearchView({ stocktakeId }: { stocktakeId: number }) {
  const base = `/api/admin/stocktakes/${stocktakeId}`;
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = useDebounced(text.trim(), SEARCH_DELAY_MS);
  const selected = Number(params.get('artikel')) || null;
  const results = useApiData<StocktakeArticleSearchResponse>(
    query.length >= 2 ? `${base}/articles/search?q=${encodeURIComponent(query)}` : null,
    liveOptions,
  );

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const data = query.length >= 2 ? results.data : undefined;
  return (
    <>
      <div className="card">
        <div className="form-row">
          <label style={{ flex: 1 }}>
            EAN, Artikelnummer, Bezeichnung oder Seriennummer
            <input
              type="search"
              value={text}
              autoFocus
              onChange={(event) => {
                setText(event.target.value);
                update({ q: event.target.value.trim() });
              }}
            />
          </label>
        </div>
        <ErrorNotice error={results.error} />
        {data && data.articles.length === 0 && data.manualEntries.length === 0 && (
          <p className="muted">Nichts gefunden.</p>
        )}
        {data && data.articles.length > 0 && (
          <div className="table-wrap article-results">
            <table>
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>EAN</th>
                  <th>Artikelnummer</th>
                  <th>Kategorie</th>
                  <th>Gefunden über</th>
                  <th className="number">Soll</th>
                  <th className="number">Ist</th>
                  <th className="number">Zeilen</th>
                </tr>
              </thead>
              <tbody>
                {data.articles.map((article) => (
                  <tr
                    key={article.articleId}
                    className={article.articleId === selected ? 'selected' : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => update({ artikel: String(article.articleId) })}
                      >
                        {article.description}
                      </button>
                      {!article.inMasterData && (
                        <div className="muted">nicht mehr in den Stammdaten</div>
                      )}
                    </td>
                    <td className="code">{article.ean ?? ''}</td>
                    <td>{article.articleNumbers.join(', ')}</td>
                    <td>{article.category ?? ''}</td>
                    <td>{MATCH_LABELS[article.matchedBy]}</td>
                    <td className="number">
                      {article.expectedQuantity === null
                        ? '–'
                        : formatNumber(article.expectedQuantity)}
                    </td>
                    <td className="number">{formatNumber(article.countedQuantity)}</td>
                    <td className="number">{formatNumber(article.lines)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.manualEntries.length > 0 && (
          <>
            <h3>Manuell erfasste Zeilen</h3>
            <EntryList entries={data.manualEntries} showArticle />
          </>
        )}
        {data?.hasMore && (
          <p className="muted">Es gibt weitere Treffer. Bitte die Suche genauer fassen.</p>
        )}
      </div>
      {selected !== null && <ArticleDetail base={base} articleId={selected} />}
    </>
  );
}

const INTRO =
  'Wo wurde ein Artikel erfasst, von wem, und was wurde geändert? Gesucht wird in den Stammdaten und in den Zeilen der Inventur.';

export function ArticleSearchPage() {
  const { stocktake } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Artikelsuche</h1>
      </div>
      <p className="muted">{INTRO}</p>
      {stocktake === null && <NoActiveStocktake />}
      {stocktake && <ArticleSearchView stocktakeId={stocktake.id} />}
    </>
  );
}

/** Article search in a stocktake from the history. */
export function StocktakeArticleSearchPage() {
  const { id } = useParams();
  const stocktake = useApiData<Stocktake>(`/api/admin/stocktakes/${Number(id)}`);
  return (
    <>
      <p>
        <Link to={`/admin/historie/${Number(id)}`}>← Zurück zur Inventur</Link>
      </p>
      <div className="page-header">
        <h1>Artikelsuche{stocktake.data && ` – ${stocktake.data.name}`}</h1>
      </div>
      <p className="muted">{INTRO}</p>
      <ArticleSearchView stocktakeId={Number(id)} />
    </>
  );
}
