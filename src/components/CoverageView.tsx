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
 */
import { FormattedMessage, useIntl } from 'react-intl';
import type { Hazard } from '../../shared/types.ts';
import { normalizeCoverage, type Representation } from '../lib/areas.ts';

/** Short, plain-text read of an area's report share vs. its estimated ridership. */
const REPRESENTATION_NOTE: Record<Representation, string> = {
  none: 'No reports yet — a likely data desert (busy enough to expect some).',
  under: 'Under-reported for its estimated ridership.',
  over: 'Heavily reported relative to its estimated ridership.',
  typical: 'About what its estimated ridership would suggest.',
};

export function CoverageView({ hazards }: { hazards: Hazard[] }) {
  const intl = useIntl();
  const areas = normalizeCoverage(hazards);
  const max = areas.reduce((m, a) => Math.max(m, a.count), 0);
  const deserts = areas.filter((a) => a.isDataDesert);

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

      {deserts.length > 0 && (
        <p className="coverage-desert-callout" role="note">
          <strong>Data deserts:</strong>{' '}
          {deserts.map((d) => d.name).join(', ')} have meaningful ridership but{' '}
          <strong>no reports yet</strong>. Treat these as gaps in the data, not as
          safe streets.
        </p>
      )}

      <ul className="coverage-list">
        {areas.map((a) => (
          <li
            key={a.name}
            className={`coverage-row${a.isDataDesert ? ' coverage-row-desert' : ''}`}
          >
            <span className="coverage-area">{a.name}</span>
            <span
              className="coverage-bar"
              aria-hidden="true"
              style={{ width: `${max ? (a.count / max) * 100 : 0}%` }}
            />
            <span className="coverage-count">
              <FormattedMessage
                id="coverage.count"
                defaultMessage="{count, plural, =0 {No reports yet} one {# report} other {# reports}}"
                values={{ count: a.count }}
              />
            </span>
            {a.exposureWeight > 0 && (
              <span className={`coverage-flag coverage-flag-${a.representation}`}>
                {REPRESENTATION_NOTE[a.representation]}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="hint coverage-limits">
        <strong>How to read this:</strong> the "estimated ridership" comparison
        is a rough heuristic, not measured exposure data, and can itself be
        biased. It's here to stop scarce reports being mistaken for safety — never
        to rank neighbourhoods. Absence of reports is absence of <em>reports</em>,
        not absence of hazards.
      </p>
    </section>
  );
}
