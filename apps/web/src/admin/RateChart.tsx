import type { RateBucket } from '@inventur/shared';
import { useState } from 'react';
import { formatNumber } from '../format.ts';

const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Minuten`;
  if (minutes === 60) return 'Stunde';
  if (minutes === 1440) return 'Tag';
  return `${minutes / 60} Stunden`;
}

/** Pieces captured per interval as a column chart with a tooltip and a table view. */
export function RateChart({
  bucketMinutes,
  buckets,
}: {
  bucketMinutes: number;
  buckets: readonly RateBucket[];
}) {
  const [hovered, setHovered] = useState<number>();
  if (buckets.length === 0) return <p className="muted">Noch keine Erfassungen.</p>;

  const spansDays =
    new Date(buckets[0]!.start).toDateString() !== new Date(buckets.at(-1)!.start).toDateString();
  const format = (iso: string) => (spansDays ? dayTime : time).format(new Date(iso));
  const range = (bucket: RateBucket) => {
    const end = new Date(Date.parse(bucket.start) + bucketMinutes * 60_000).toISOString();
    return `${format(bucket.start)} – ${format(end)}`;
  };
  const max = Math.max(1, ...buckets.map((b) => b.quantity));
  const active = hovered === undefined ? undefined : buckets[hovered];
  const labelled = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);

  return (
    <figure className="rate-chart">
      <figcaption className="muted">Stück je {intervalLabel(bucketMinutes)}</figcaption>
      <div className="rate-plot">
        <div className="rate-axis" aria-hidden="true">
          <span>{formatNumber(max)}</span>
          <span>0</span>
        </div>
        <div className="rate-bars" onMouseLeave={() => setHovered(undefined)}>
          {buckets.map((bucket, index) => (
            <div
              key={bucket.start}
              className={`rate-bar${index === hovered ? ' hovered' : ''}`}
              tabIndex={0}
              aria-label={`${range(bucket)}: ${formatNumber(bucket.quantity)} Stück, ${formatNumber(bucket.lines)} Zeilen`}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(undefined)}
            >
              {bucket.quantity > 0 && (
                <div className="mark" style={{ height: `${(bucket.quantity / max) * 100}%` }} />
              )}
            </div>
          ))}
          {active && hovered !== undefined && (
            <div
              className="rate-tooltip"
              role="status"
              style={{
                left: `${((hovered + 0.5) / buckets.length) * 100}%`,
                transform: `translateX(${hovered < buckets.length / 2 ? '0' : '-100%'})`,
              }}
            >
              <div className="muted">{range(active)}</div>
              <div>
                <strong>{formatNumber(active.quantity)}</strong> Stück
              </div>
              <div>{formatNumber(active.lines)} Zeilen</div>
            </div>
          )}
        </div>
      </div>
      <div className="rate-labels" aria-hidden="true">
        {buckets.map((bucket, index) => (
          <span key={bucket.start}>{labelled.has(index) ? format(bucket.start) : ''}</span>
        ))}
      </div>
      <details>
        <summary>Als Tabelle anzeigen</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th className="number">Zeilen</th>
                <th className="number">Stück</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.start}>
                  <td>{range(bucket)}</td>
                  <td className="number">{formatNumber(bucket.lines)}</td>
                  <td className="number">{formatNumber(bucket.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
