/**
 * Reports received per area per month (issue #180, research roadmap E8): the
 * coverage view's set, split by the month each report was received.
 *
 * The table is the whole representation; there is no chart for it to be the
 * fallback of. It says "received", never "happened", and it carries a limits note
 * as the coverage view does, because a monthly series of crowd reports ranks the
 * streets whose riders report most.
 *
 * Three states, and no number is printed under a claim it cannot support:
 *   loading      say so; no numbers.
 *   unavailable  say so; no numbers. Unlike CoverageView there is nothing to fall
 *                back to: the live feed carries no history at all.
 *   loaded       the table, plus the months the server left out, named as left out.
 */
import { useEffect, useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { ReportTrends } from '../../shared/recurrence.ts';
import { fetchTrends } from '../lib/api.ts';
import { useLabels } from '../i18n/labels.ts';

/** The select's value for every area at once. Never an area name: pack names are non-empty. */
export const ALL_AREAS = '';

export interface TrendRow {
  month: string;
  received: number;
  confirmed: number;
  resolved: number;
}

/**
 * The rows the table shows for one area, or summed over every area, newest month
 * first. Exported so the arithmetic is tested apart from the rendering.
 */
export function trendRows(trends: ReportTrends, area: string): TrendRow[] {
  return trends.months
    .map((m) => {
      const areas = area === ALL_AREAS ? m.areas : m.areas.filter((a) => a.name === area);
      return {
        month: m.month,
        received: areas.reduce((total, a) => total + a.received, 0),
        confirmed: areas.reduce((total, a) => total + a.confirmed, 0),
        resolved: areas.reduce((total, a) => total + a.resolved, 0),
      };
    })
    .reverse();
}

export function TrendsView() {
  const intl = useIntl();
  const labels = useLabels();
  const [trends, setTrends] = useState<ReportTrends | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [area, setArea] = useState(ALL_AREAS);

  useEffect(() => {
    let cancelled = false;
    fetchTrends().then(
      (loaded) => {
        if (!cancelled) setTrends(loaded);
      },
      () => {
        if (!cancelled) setUnavailable(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => (trends ? trendRows(trends, area) : []), [trends, area]);
  const areaNames = trends?.months[0]?.areas.map((a) => a.name) ?? [];
  const loading = trends === null && !unavailable;
  const strong = (chunks: React.ReactNode[]) => <strong>{chunks}</strong>;

  return (
    <section
      className="trends"
      aria-label={intl.formatMessage({ id: 'trends.aria', defaultMessage: 'Reports by month' })}
    >
      <h2>
        <FormattedMessage id="trends.heading" defaultMessage="Reports by month" />
      </h2>
      <p className="hint">
        <FormattedMessage
          id="trends.hint"
          defaultMessage="How many hazards were <strong>reported</strong> each month, and what has happened to those reports since. These are reports received, not how often something happened."
          values={{ strong }}
        />
      </p>

      {loading && (
        <p className="hint trends-loading">
          <FormattedMessage id="trends.loading" defaultMessage="Loading monthly totals…" />
        </p>
      )}

      {unavailable && (
        <p className="coverage-partial" role="note">
          <FormattedMessage
            id="trends.unavailable"
            defaultMessage="<strong>The monthly totals could not be loaded</strong>, so none are shown. There is nothing to fall back on here: the map only carries what is on it now."
            values={{ strong }}
          />
        </p>
      )}

      {trends && trends.months.length === 0 && (
        <p className="empty-state">
          <FormattedMessage
            id="trends.empty"
            defaultMessage="No reports have been received yet, so there is no month to show. That means nothing has been <strong>reported</strong> — not that nothing is there."
            values={{ strong }}
          />
        </p>
      )}

      {trends && trends.months.length > 0 && (
        <>
          <div className="filter-row">
            <label htmlFor="trends-area">
              <FormattedMessage id="trends.area" defaultMessage="Area" />
            </label>
            <select id="trends-area" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value={ALL_AREAS}>
                {intl.formatMessage({ id: 'trends.allAreas', defaultMessage: 'All areas' })}
              </option>
              {areaNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="trends-scroll">
            <table className="trends-table">
              <caption>
                {area === ALL_AREAS ? (
                  <FormattedMessage
                    id="trends.caption.all"
                    defaultMessage="Reports received each month, all areas"
                  />
                ) : (
                  <FormattedMessage
                    id="trends.caption.area"
                    defaultMessage="Reports received each month in {area}"
                    values={{ area }}
                  />
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <FormattedMessage id="trends.col.month" defaultMessage="Month" />
                  </th>
                  <th scope="col">
                    <FormattedMessage id="trends.col.received" defaultMessage="Reports received" />
                  </th>
                  <th scope="col">
                    <FormattedMessage
                      id="trends.col.confirmed"
                      defaultMessage="Confirmed by another rider, so far"
                    />
                  </th>
                  <th scope="col">
                    <FormattedMessage id="trends.col.resolved" defaultMessage="Marked fixed, so far" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <th scope="row">{labels.month(row.month)}</th>
                    <td>{intl.formatNumber(row.received)}</td>
                    <td>{intl.formatNumber(row.confirmed)}</td>
                    <td>{intl.formatNumber(row.resolved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            <FormattedMessage
              id="trends.cohort"
              defaultMessage="Each row counts the reports received that month. “Confirmed” and “marked fixed” are what has happened to those reports so far, so a past month can still change."
            />
          </p>
          {trends.omittedMonths > 0 && (
            <p className="hint trends-omitted">
              <FormattedMessage
                id="trends.omitted"
                defaultMessage="{count, plural, one {# month} other {# months}} in this span had no reports anywhere and {count, plural, one {is} other {are}} left out rather than shown as zero: this service cannot tell a quiet month from one it was not running in."
                values={{ count: trends.omittedMonths }}
              />
            </p>
          )}
          {trends.seedExcluded > 0 && (
            <p className="hint trends-seed">
              <FormattedMessage
                id="trends.seedExcluded"
                defaultMessage="{count, plural, one {# illustrative demo hazard is} other {# illustrative demo hazards are}} not counted: demo data is fiction, and its dates are invented."
                values={{ count: trends.seedExcluded }}
              />
            </p>
          )}
        </>
      )}

      <p className="hint coverage-limits">
        <FormattedMessage
          id="trends.limits"
          defaultMessage="<strong>How to read this:</strong> a month's count is how many reports riders sent, not how dangerous the streets were. An area riders rarely report reads low here whether or not it is safe. It is here to show where reports come from and what happens to them — never to rank neighbourhoods."
          values={{ strong }}
        />
      </p>
    </section>
  );
}
