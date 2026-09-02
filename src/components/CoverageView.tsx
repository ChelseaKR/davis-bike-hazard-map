/**
 * Reports-by-area view (coverage equity). Makes "few/no reports" legible as
 * under-reporting rather than safety, and nudges people to fill the gaps.
 *
 * Beyond raw counts, it normalizes each area's reports against a coarse
 * estimate of how much cycling happens there (research roadmap R4 / EV-SKEW) so
 * a busy area with few reports reads as a *data desert*, not as "safe". The
 * normalization is a rough heuristic, so it is always shown qualitatively and
 * paired with an explicit limits note. Counts and flags are conveyed as text
 * (the bar is decorative / aria-hidden).
 *
 * WHICH SET IS COUNTED. The numbers come from `GET /api/coverage`: reports
 * RECEIVED, minus rejected ones. Not the public hazard feed. The feed carries
 * only approved, unexpired hazards plus recently-resolved ones, so an area
 * whose reports are all still in the moderation queue, or have since expired,
 * would show zero and be labelled a data desert — asserting the exact opposite
 * of the truth in the one surface built to stop absence reading as safety.
 *
 * When that call fails (offline, server down) the view falls back to what is in
 * the feed, says so, and — critically — withholds every data-desert and
 * over/under-reported flag, because from the feed alone it cannot tell "nobody
 * has reported here" from "nothing here is currently active".
 */
import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import type { Hazard } from '../../shared/types.ts';
import type { AreaCount } from '../../shared/areas.ts';
import { bucketByArea, normalizeCoverage } from '../lib/areas.ts';
import { fetchCoverage } from '../lib/api.ts';

/** Short, plain-text read of an area's report share vs. its estimated ridership. */
const REPRESENTATION_NOTE = defineMessages({
  none: {
    id: 'coverage.representation.none',
    defaultMessage: 'No reports yet — a likely data desert (busy enough to expect some).',
  },
  under: {
    id: 'coverage.representation.under',
    defaultMessage: 'Under-reported for its estimated ridership.',
  },
  over: {
    id: 'coverage.representation.over',
    defaultMessage: 'Heavily reported relative to its estimated ridership.',
  },
  typical: {
    id: 'coverage.representation.typical',
    defaultMessage: 'About what its estimated ridership would suggest.',
  },
});

export function CoverageView({ hazards }: { hazards: Hazard[] }) {
  const intl = useIntl();
  const [received, setReceived] = useState<AreaCount[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCoverage()
      .then((areas) => {
        if (!cancelled) setReceived(areas);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Three states, and no count is ever printed under a claim it cannot support:
  //   loading     - say so; print no per-area numbers at all, because the only
  //                 numbers available are the feed's and they are not "reports".
  //   unavailable - print the feed's numbers, labelled as the feed, no flags.
  //   loaded      - print reports received, with the data-desert flags.
  // Flags (data desert, over/under-reported) are only ever derived from reports
  // received. Never from the feed - see the module comment.
  const loading = received === null && !unavailable;
  const areas = normalizeCoverage(received ?? bucketByArea(hazards));
  const flagged = received !== null;
  const deserts = flagged ? areas.filter((a) => a.isDataDesert) : [];
  const max = areas.reduce((m, a) => Math.max(m, a.count), 0);

  return (
    <section
      className="coverage"
      aria-label={intl.formatMessage({ id: 'coverage.aria', defaultMessage: 'Reports by area' })}
    >
      <h2>
        <FormattedMessage id="coverage.heading" defaultMessage="Reports by area" />
      </h2>
      <p className="hint">
        <FormattedMessage
          id="coverage.hint"
          defaultMessage="How many hazards have been <strong>reported</strong> in each part of Davis, and how that compares to roughly how much cycling happens there. Few or no reports in an area means it's <strong>under-reported</strong> — not that it's safe. Help close the gap by reporting what you see."
          values={{ strong: (chunks) => <strong>{chunks}</strong> }}
        />
      </p>

      {loading && (
        <p className="hint coverage-loading">
          <FormattedMessage id="coverage.loading" defaultMessage="Loading report totals…" />
        </p>
      )}

      {unavailable && (
        <p className="coverage-partial" role="note">
          <FormattedMessage
            id="coverage.partial"
            defaultMessage="<strong>Partial view:</strong> the report totals could not be loaded, so these are only the hazards currently on the map. An area that has been reported but whose reports are awaiting review, or have since expired, shows as zero here — so the data-desert comparison is withheld rather than guessed."
            values={{ strong: (chunks) => <strong>{chunks}</strong> }}
          />
        </p>
      )}

      {deserts.length > 0 && (
        <p className="coverage-desert-callout" role="note">
          <FormattedMessage
            id="coverage.deserts"
            defaultMessage="<strong>Data deserts:</strong> {areas} have meaningful ridership but <strong>no reports yet</strong>. Treat these as gaps in the data, not as safe streets."
            values={{
              areas: deserts.map((d) => d.name).join(', '),
              strong: (chunks) => <strong>{chunks}</strong>,
            }}
          />
        </p>
      )}

      {!loading && (
        <ul className="coverage-list">
          {areas.map((a) => (
            <li
              key={a.name}
              className={`coverage-row${flagged && a.isDataDesert ? ' coverage-row-desert' : ''}`}
            >
              <span className="coverage-area">{a.name}</span>
              <span
                className="coverage-bar"
                aria-hidden="true"
                style={{ width: `${max ? (a.count / max) * 100 : 0}%` }}
              />
              <span className="coverage-count">
                {flagged ? (
                  <FormattedMessage
                    id="coverage.count"
                    defaultMessage="{count, plural, =0 {No reports yet} one {# report} other {# reports}}"
                    values={{ count: a.count }}
                  />
                ) : (
                  // Fallback wording, because in this state the number is what
                  // is on the map, not what has been reported. "No reports yet"
                  // here would be the very claim this view exists to prevent.
                  <FormattedMessage
                    id="coverage.countOnMap"
                    defaultMessage="{count, plural, =0 {None on the map right now} one {# on the map} other {# on the map}}"
                    values={{ count: a.count }}
                  />
                )}
              </span>
              {flagged && a.exposureWeight > 0 && (
                <span className={`coverage-flag coverage-flag-${a.representation}`}>
                  {intl.formatMessage(REPRESENTATION_NOTE[a.representation])}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="hint coverage-limits">
        <FormattedMessage
          id="coverage.limits"
          defaultMessage={'<strong>How to read this:</strong> the "estimated ridership" comparison is a rough heuristic, not measured exposure data, and can itself be biased. It\'s here to stop scarce reports being mistaken for safety — never to rank neighbourhoods. Absence of reports is absence of <em>reports</em>, not absence of hazards.'}
          values={{
            strong: (chunks) => <strong>{chunks}</strong>,
            em: (chunks) => <em>{chunks}</em>,
          }}
        />
      </p>
    </section>
  );
}
