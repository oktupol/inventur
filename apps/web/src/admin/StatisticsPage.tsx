import type {
  CaptureCount,
  DomainEvent,
  Reconciliation,
  ShortageArticle,
  Stocktake,
  StocktakeStatistics,
  SurplusKind,
  WorkAreaStatus,
} from '@inventur/shared';
import { Link, useParams } from 'react-router';
import { useApiData } from '../api/useApiData.ts';
import { ErrorNotice } from '../components/Notice.tsx';
import { WorkAreaStatusBadge } from '../components/WorkArea.tsx';
import { formatDateTime, formatEuro, formatNumber, WORK_AREA_STATUS_LABELS } from '../format.ts';
import { NoActiveStocktake, useActiveStocktake } from './ActiveStocktake.tsx';
import { RateChart } from './RateChart.tsx';
import { ArticleLink, ArticleSearchPath } from './ArticleLink.tsx';

/** Statistics are computed over all lines, so reload them at most this often. */
const STATISTICS_THROTTLE_MS = 2_000;
/** The comparison reads the whole master data. */
const RECONCILIATION_THROTTLE_MS = 5_000;

const statisticsEvents = new Set<DomainEvent['type']>([
  'stocktake.changed',
  'work_area.changed',
  'workstation.changed',
  'employee.changed',
  'entry.changed',
]);

export function categoryLabel(category: string | null, manual = false): string {
  if (manual) return 'ohne Kategorie (manuell)';
  return category ?? 'ohne Kategorie';
}

function euroOrDash(amount: string | null): string {
  return amount === null ? '–' : formatEuro(amount);
}

export function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat">
      <div className={value.length > 10 ? 'value long' : 'value'}>{value}</div>
      <div className="label">{label}</div>
      {detail && <div className="label">{detail}</div>}
    </div>
  );
}

const STATUS_ORDER: WorkAreaStatus[] = ['closed', 'in_progress', 'open'];

function Progress({ progress }: { progress: StocktakeStatistics['progress'] }) {
  if (progress.total === 0) return <p className="muted">Noch keine Arbeitsbereiche.</p>;
  return (
    <div className="progress">
      <div
        className="progress-bar"
        role="img"
        aria-label={STATUS_ORDER.map(
          (status) => `${progress[status]} ${WORK_AREA_STATUS_LABELS[status]}`,
        ).join(', ')}
      >
        {STATUS_ORDER.filter((status) => progress[status] > 0).map((status) => (
          <div
            key={status}
            className={`segment ${status}`}
            style={{ flexGrow: progress[status] }}
            title={`${WORK_AREA_STATUS_LABELS[status]}: ${progress[status]}`}
          />
        ))}
      </div>
      <ul className="progress-legend">
        {STATUS_ORDER.map((status) => (
          <li key={status}>
            <span className={`swatch ${status}`} aria-hidden="true" />
            {WORK_AREA_STATUS_LABELS[status]} <strong>{formatNumber(progress[status])}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TotalsCells({
  lines,
  quantity,
  net,
  gross,
}: {
  lines: number;
  quantity: number;
  net: string | null;
  gross: string;
}) {
  return (
    <>
      <td className="number">{formatNumber(lines)}</td>
      <td className="number">{formatNumber(quantity)}</td>
      <td className="number">{euroOrDash(net)}</td>
      <td className="number">{formatEuro(gross)}</td>
    </>
  );
}

const totalsHeaders = (
  <>
    <th className="number">Zeilen</th>
    <th className="number">Stück</th>
    <th className="number">Wert netto</th>
    <th className="number">Wert brutto</th>
  </>
);

function CountTable({ title, rows }: { title: string; rows: readonly CaptureCount[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Noch keine Erfassungen.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="number">Zeilen</th>
                <th className="number">Stück</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="number">{formatNumber(row.lines)}</td>
                  <td className="number">{formatNumber(row.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatisticsSections({ stats }: { stats: StocktakeStatistics }) {
  const { totals, progress, manual } = stats;
  return (
    <>
      <div className="card">
        <h2>Überblick</h2>
        <div className="stats">
          <Tile
            label="Bereiche abgeschlossen"
            value={`${formatNumber(progress.closed)} / ${formatNumber(progress.total)}`}
          />
          <Tile label="Zeilen" value={formatNumber(totals.lines)} />
          <Tile label="Stück" value={formatNumber(totals.quantity)} />
          <Tile label="Wert netto" value={formatEuro(totals.net)} detail="ohne manuelle Artikel" />
          <Tile label="Wert brutto" value={formatEuro(totals.gross)} />
        </div>
        <Progress progress={progress} />
      </div>

      <div className="card">
        <h2>Je Arbeitsbereich</h2>
        {stats.byWorkArea.length === 0 ? (
          <p className="muted">Noch keine Arbeitsbereiche.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arbeitsbereich</th>
                  <th>Status</th>
                  {totalsHeaders}
                </tr>
              </thead>
              <tbody>
                {stats.byWorkArea.map((area) => (
                  <tr key={area.id}>
                    <td>{area.name}</td>
                    <td>
                      <WorkAreaStatusBadge status={area.status} />
                    </td>
                    <TotalsCells {...area} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Je Kategorie</h2>
        {stats.byCategory.length === 0 ? (
          <p className="muted">Noch keine Erfassungen.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kategorie</th>
                  {totalsHeaders}
                </tr>
              </thead>
              <tbody>
                {stats.byCategory.map((category) => (
                  <tr key={`${category.manual}-${category.category}`}>
                    <td className={category.category === null ? 'muted' : undefined}>
                      {categoryLabel(category.category, category.manual)}
                    </td>
                    <TotalsCells {...category} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Erfassungsrate</h2>
        <RateChart {...stats.rate} />
        <div className="stats-columns">
          <CountTable title="Je Mitarbeiter" rows={stats.byEmployee} />
          <CountTable title="Je Station" rows={stats.byWorkstation} />
        </div>
      </div>

      <div className="card">
        <h2>Manuell erfasste Artikel</h2>
        <div className="stats">
          <Tile label="Zeilen" value={formatNumber(manual.lines)} />
          <Tile label="Stück" value={formatNumber(manual.quantity)} />
          <Tile label="Wert brutto" value={formatEuro(manual.gross)} />
        </div>
        {manual.entries.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Bezeichnung</th>
                  <th>Eingabe</th>
                  <th>Seriennummer</th>
                  <th>Arbeitsbereich</th>
                  <th>Station</th>
                  <th className="number">Menge</th>
                  <th className="number">Preis brutto</th>
                  <th className="number">Summe brutto</th>
                </tr>
              </thead>
              <tbody>
                {manual.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.description}</td>
                    <td>{entry.input}</td>
                    <td>{entry.serialNumber ?? ''}</td>
                    <td>{entry.workArea.name}</td>
                    <td>{entry.workstation.name}</td>
                    <td className="number">{formatNumber(entry.quantity)}</td>
                    <td className="number">{formatEuro(entry.priceGross)}</td>
                    <td className="number">{formatEuro(entry.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Auffälligkeiten</h2>
        <p className="muted">
          Artikel, die öfter erfasst wurden, als ihre Soll-Anzahl in den Stammdaten angibt.
        </p>
        {stats.overcounted.length === 0 ? (
          <p>Keine Auffälligkeiten.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>EAN</th>
                  <th>Arbeitsbereiche</th>
                  <th className="number">Zeilen</th>
                  <th className="number">Soll</th>
                  <th className="number">Ist</th>
                </tr>
              </thead>
              <tbody>
                {stats.overcounted.map((article) => (
                  <tr key={article.articleId}>
                    <td>
                      <ArticleLink articleId={article.articleId}>{article.description}</ArticleLink>
                    </td>
                    <td>{article.ean ?? ''}</td>
                    <td>{article.workAreas.map((area) => area.name).join(', ')}</td>
                    <td className="number">{formatNumber(article.lines)}</td>
                    <td className="number">{formatNumber(article.expected)}</td>
                    <td className="number">{formatNumber(article.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const SURPLUS_KIND_LABELS: Record<SurplusKind, string> = {
  excess: 'zu viel erfasst',
  unknown: 'nicht mehr in den Stammdaten',
  manual: 'manuell erfasst',
};

function ShortageList({ articles }: { articles: readonly ShortageArticle[] }) {
  const groups: { category: string | null; articles: ShortageArticle[] }[] = [];
  for (const article of articles) {
    const last = groups.at(-1);
    if (last && last.category === article.category) last.articles.push(article);
    else groups.push({ category: article.category, articles: [article] });
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>EAN</th>
            <th className="number">Soll</th>
            <th className="number">Ist</th>
            <th className="number">Fehlt</th>
            <th className="number">Preis brutto</th>
            <th className="number">Wert netto</th>
            <th className="number">Wert brutto</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.category ?? ''}>
            <tr className="group-header">
              <th colSpan={8}>{categoryLabel(group.category)}</th>
            </tr>
            {group.articles.map((article) => (
              <tr key={article.articleId}>
                <td>
                  <ArticleLink articleId={article.articleId}>{article.description}</ArticleLink>
                </td>
                <td>{article.ean ?? ''}</td>
                <td className="number">{formatNumber(article.expected)}</td>
                <td className="number">{formatNumber(article.counted)}</td>
                <td className="number">{formatNumber(article.missing)}</td>
                <td className="number">{formatEuro(article.priceGross)}</td>
                <td className="number">{formatEuro(article.net)}</td>
                <td className="number">{formatEuro(article.gross)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function ReconciliationSection({ result }: { result: Reconciliation }) {
  const { shortage, surplus } = result;
  return (
    <div className="card">
      <h2>Soll/Ist-Abgleich</h2>
      <p className="muted">
        Verglichen werden {formatNumber(result.articleCount)} Artikel der aktuellen Stammdaten mit
        zusammen {formatNumber(result.expectedQuantity)} Stück Soll-Bestand.
        {result.withoutTargetCount > 0 &&
          ` ${formatNumber(result.withoutTargetCount)} Artikel ohne Soll-Anzahl sind nicht berücksichtigt.`}
      </p>

      <h3>Fehlbestand</h3>
      <div className="stats">
        <Tile label="Artikel mit Fehlmenge" value={formatNumber(shortage.count)} />
        <Tile label="Stück fehlen" value={formatNumber(shortage.quantity)} />
        <Tile label="Wert netto" value={formatEuro(shortage.net)} />
        <Tile label="Wert brutto" value={formatEuro(shortage.gross)} />
      </div>
      {shortage.byCategory.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kategorie</th>
                  <th className="number">Artikel</th>
                  <th className="number">Stück</th>
                  <th className="number">Wert netto</th>
                  <th className="number">Wert brutto</th>
                </tr>
              </thead>
              <tbody>
                {shortage.byCategory.map((category) => (
                  <tr key={category.category ?? ''}>
                    <td className={category.category === null ? 'muted' : undefined}>
                      {categoryLabel(category.category)}
                    </td>
                    <td className="number">{formatNumber(category.count)}</td>
                    <td className="number">{formatNumber(category.quantity)}</td>
                    <td className="number">{formatEuro(category.net)}</td>
                    <td className="number">{formatEuro(category.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="shortage-list">
            <summary>
              Liste der Artikel mit Fehlmenge
              {shortage.truncated &&
                ` (die ersten ${formatNumber(shortage.articles.length)} von ${formatNumber(shortage.count)})`}
            </summary>
            {shortage.truncated && (
              <p className="muted">
                Die Liste ist gekürzt. Die vollständige Liste enthält der Export des
                Soll/Ist-Abgleichs.
              </p>
            )}
            <ShortageList articles={shortage.articles} />
          </details>
        </>
      )}

      <h3>Mehrbestand</h3>
      <div className="stats">
        <Tile label="Stück zu viel" value={formatNumber(surplus.quantity)} />
        <Tile label="Wert netto" value={formatEuro(surplus.net)} detail="ohne manuelle Artikel" />
        <Tile label="Wert brutto" value={formatEuro(surplus.gross)} />
      </div>
      {surplus.items.length === 0 ? (
        <p>Kein Mehrbestand.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>EAN</th>
                <th>Kategorie</th>
                <th>Grund</th>
                <th className="number">Soll</th>
                <th className="number">Ist</th>
                <th className="number">Mehr</th>
                <th className="number">Wert netto</th>
                <th className="number">Wert brutto</th>
              </tr>
            </thead>
            <tbody>
              {surplus.items.map((item) => (
                <tr key={item.entryId === null ? `a${item.articleId}` : `e${item.entryId}`}>
                  <td>
                    {item.articleId === null ? (
                      item.description
                    ) : (
                      <ArticleLink articleId={item.articleId}>{item.description}</ArticleLink>
                    )}
                  </td>
                  <td>{item.ean ?? ''}</td>
                  <td className={item.category === null ? 'muted' : undefined}>
                    {categoryLabel(item.category, item.kind === 'manual')}
                  </td>
                  <td>{SURPLUS_KIND_LABELS[item.kind]}</td>
                  <td className="number">{formatNumber(item.expected)}</td>
                  <td className="number">{formatNumber(item.counted)}</td>
                  <td className="number">{formatNumber(item.surplus)}</td>
                  <td className="number">{euroOrDash(item.net)}</td>
                  <td className="number">{formatEuro(item.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Statistics of a stocktake, updated live while it is active. */
export function StatisticsView({
  stocktakeId,
  articleSearchPath,
}: {
  stocktakeId: number;
  /** Where articles in the lists link to. */
  articleSearchPath: string;
}) {
  const base = `/api/admin/stocktakes/${stocktakeId}`;
  const stats = useApiData<StocktakeStatistics>(`${base}/statistics`, {
    channels: ['admin'],
    filter: (event) => statisticsEvents.has(event.type),
    throttleMs: STATISTICS_THROTTLE_MS,
  });
  const reconciliation = useApiData<Reconciliation>(`${base}/reconciliation`, {
    channels: ['admin'],
    filter: (event) => event.type === 'entry.changed',
    throttleMs: RECONCILIATION_THROTTLE_MS,
  });
  return (
    <ArticleSearchPath.Provider value={articleSearchPath}>
      <ErrorNotice error={stats.error} />
      {stats.loading && <p className="muted">Wird geladen …</p>}
      {stats.data && <StatisticsSections stats={stats.data} />}
      <ErrorNotice error={reconciliation.error} />
      {reconciliation.data && <ReconciliationSection result={reconciliation.data} />}
    </ArticleSearchPath.Provider>
  );
}

/** Statistics of the active stocktake. */
export function StatisticsPage() {
  const { stocktake } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Statistik</h1>
      </div>
      {stocktake === null && <NoActiveStocktake />}
      {stocktake && (
        <StatisticsView stocktakeId={stocktake.id} articleSearchPath="/admin/artikel" />
      )}
    </>
  );
}

/** Statistics of a stocktake from the history. */
export function StocktakeStatisticsPage() {
  const { id } = useParams();
  const stocktake = useApiData<Stocktake>(`/api/admin/stocktakes/${Number(id)}`);
  return (
    <>
      <p>
        <Link to={`/admin/historie/${Number(id)}`}>← Zurück zur Inventur</Link>
      </p>
      <div className="page-header">
        <h1>Statistik{stocktake.data && ` – ${stocktake.data.name}`}</h1>
      </div>
      <StatisticsView
        stocktakeId={Number(id)}
        articleSearchPath={`/admin/historie/${Number(id)}/artikel`}
      />
    </>
  );
}
