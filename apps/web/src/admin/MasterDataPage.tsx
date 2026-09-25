import type {
  MasterDataArticle,
  MasterDataArticlePage,
  MasterDataCheck,
  MasterDataCheckKind,
  MasterDataOverview,
} from '@inventur/shared';
import { useEffect, useState } from 'react';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatEuro, formatNumber } from '../format.ts';
import { categoryLabel, Tile } from './StatisticsPage.tsx';

const CHECKS: Record<MasterDataCheckKind, { title: string; hint: string }> = {
  duplicate_ean: {
    title: 'Doppelte EANs',
    hint: 'Mehrere Artikel mit derselben EAN führen bei der Erfassung zur Auswahl (gelb).',
  },
  duplicate_article_number: {
    title: 'Doppelte Artikelnummern',
    hint: 'Mehrere Artikel mit derselben Artikelnummer führen bei der Erfassung zur Auswahl (gelb).',
  },
  without_code: {
    title: 'Ohne EAN und Artikelnummer',
    hint: 'Diese Artikel lassen sich nur über die Bezeichnung finden, nicht scannen.',
  },
  invalid_ean: {
    title: 'EAN mit falscher Prüfziffer',
    hint: 'EANs mit 8 oder 13 Ziffern, deren Prüfziffer nicht stimmt. Scanner lesen sie meist nicht.',
  },
  zero_price: {
    title: 'Preis 0 €',
    hint: 'Netto- oder Bruttopreis ist 0 €. Diese Artikel haben keinen Wert in der Inventur.',
  },
  gross_below_net: {
    title: 'Bruttopreis kleiner als Nettopreis',
    hint: 'Vermutlich sind Netto- und Bruttopreis vertauscht.',
  },
};

/** Articles per page, as the server returns them. */
const PAGE_SIZE = 100;

function ArticleTable({
  articles,
  codeOf,
}: {
  articles: readonly MasterDataArticle[];
  codeOf?: (index: number) => string | null;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {codeOf && <th>Betrifft</th>}
            <th>Bezeichnung</th>
            <th>EAN</th>
            <th>Artikelnummern</th>
            <th>Kategorie</th>
            <th className="number">Preis netto</th>
            <th className="number">Preis brutto</th>
            <th className="number">Soll</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((article, index) => (
            <tr key={`${article.id}-${index}`}>
              {codeOf && <td className="code">{codeOf(index) ?? ''}</td>}
              <td>{article.description}</td>
              <td className="code">{article.ean ?? ''}</td>
              <td>{article.articleNumbers.join(', ')}</td>
              <td className={article.category === null ? 'muted' : undefined}>
                {categoryLabel(article.category)}
              </td>
              <td className="number">{formatEuro(article.priceNet)}</td>
              <td className="number">{formatEuro(article.priceGross)}</td>
              <td className="number">
                {article.expectedQuantity === null ? '–' : formatNumber(article.expectedQuantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CheckItem({ check }: { check: MasterDataCheck }) {
  const { title, hint } = CHECKS[check.kind];
  return (
    <details className={`check ${check.count === 0 ? 'ok' : 'warning'}`}>
      <summary>
        <span className="check-count">{formatNumber(check.count)}</span> {title}
      </summary>
      <p className="muted">{hint}</p>
      {check.count > 0 && (
        <>
          {check.truncated && (
            <p className="muted">
              Es werden die ersten {formatNumber(check.issues.length)} Einträge gezeigt.
            </p>
          )}
          <ArticleTable
            articles={check.issues.map((issue) => issue.article)}
            codeOf={
              check.kind.startsWith('duplicate') || check.kind === 'invalid_ean'
                ? (index) => check.issues[index]!.code
                : undefined
            }
          />
        </>
      )}
    </details>
  );
}

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function ArticleList() {
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 250);
  const [page, setPage] = useState({ query: '', offset: 0 });
  const offset = page.query === query ? page.offset : 0;
  const params = new URLSearchParams({ q: query, offset: String(offset) });
  const list = useApiData<MasterDataArticlePage>(`/api/admin/master-data/articles?${params}`);
  const data = list.data;
  const last = data ? Math.min(data.offset + data.articles.length, data.total) : 0;

  return (
    <div className="card">
      <h2>Artikel</h2>
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Suche nach EAN, Artikelnummer oder Bezeichnung
          <input type="search" value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      </div>
      <ErrorNotice error={list.error} />
      {data && data.total === 0 && <p className="muted">Keine Artikel gefunden.</p>}
      {data && data.total > 0 && (
        <>
          <ArticleTable articles={data.articles} />
          <div className="form-row pager">
            <button
              type="button"
              className="small"
              disabled={offset === 0}
              onClick={() => setPage({ query, offset: Math.max(0, offset - PAGE_SIZE) })}
            >
              Zurück
            </button>
            <span className="muted">
              {formatNumber(data.offset + 1)}–{formatNumber(last)} von {formatNumber(data.total)}
              {data.hasMore && ' (weitere Treffer, bitte die Suche genauer fassen)'}
            </span>
            <button
              type="button"
              className="small"
              disabled={last >= data.total}
              onClick={() => setPage({ query, offset: offset + PAGE_SIZE })}
            >
              Weiter
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Key figures and checks of the master data, independent of a stocktake.
 * Computed on request, because the application learns nothing of changes.
 */
export function MasterDataPage() {
  const overview = useApiData<MasterDataOverview>('/api/admin/master-data/overview');
  const data = overview.data;
  return (
    <>
      <div className="page-header">
        <h1>Stammdaten</h1>
        <button type="button" disabled={overview.loading} onClick={overview.reload}>
          Aktualisieren
        </button>
      </div>
      <p className="muted">
        Die Stammdaten werden außerhalb der Anwendung gepflegt. Die Übersicht zeigt ihren Stand beim
        Laden der Seite.
      </p>
      <ErrorNotice error={overview.error} />
      {overview.loading && !data && <p className="muted">Wird geladen …</p>}
      {data && (
        <>
          <div className="card">
            <h2>Überblick</h2>
            <div className="stats">
              <Tile label="Artikel" value={formatNumber(data.articleCount)} />
              <Tile
                label="mit EAN"
                value={formatNumber(data.withEan)}
                detail={`${formatNumber(data.articleCount - data.withEan)} ohne`}
              />
              <Tile
                label="mit Artikelnummer"
                value={formatNumber(data.withArticleNumber)}
                detail={`${formatNumber(data.articleCount - data.withArticleNumber)} ohne`}
              />
              <Tile label="ohne Soll-Anzahl" value={formatNumber(data.withoutExpectedQuantity)} />
              <Tile label="Soll-Stück" value={formatNumber(data.expected.quantity)} />
              <Tile label="Soll-Wert netto" value={formatEuro(data.expected.net)} />
              <Tile label="Soll-Wert brutto" value={formatEuro(data.expected.gross)} />
            </div>
            <h3>Je Kategorie</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th className="number">Artikel</th>
                    <th className="number">mit Soll</th>
                    <th className="number">Soll-Stück</th>
                    <th className="number">Soll-Wert netto</th>
                    <th className="number">Soll-Wert brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCategory.map((row) => (
                    <tr key={row.category ?? ''}>
                      <td className={row.category === null ? 'muted' : undefined}>
                        {categoryLabel(row.category)}
                      </td>
                      <td className="number">{formatNumber(row.articleCount)}</td>
                      <td className="number">{formatNumber(row.articles)}</td>
                      <td className="number">{formatNumber(row.quantity)}</td>
                      <td className="number">{formatEuro(row.net)}</td>
                      <td className="number">{formatEuro(row.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>Prüfungen</h2>
            {data.checks.map((check) => (
              <CheckItem key={check.kind} check={check} />
            ))}
          </div>
        </>
      )}
      <ArticleList />
    </>
  );
}
