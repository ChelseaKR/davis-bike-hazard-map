/**
 * Reports-by-area view (coverage equity). Makes "few/no reports" legible as
 * under-reporting rather than safety, and nudges people to fill the gaps.
 * Counts are conveyed as text (the bar is decorative / aria-hidden).
 */
import type { Hazard } from '../../shared/types.ts';
import { bucketByArea } from '../lib/areas.ts';

export function CoverageView({ hazards }: { hazards: Hazard[] }) {
  const areas = bucketByArea(hazards);
  const max = areas.reduce((m, a) => Math.max(m, a.count), 0);

  return (
    <section className="coverage" aria-label="Reports by area">
      <h2>Reports by area</h2>
      <p className="hint">
        How many hazards have been <strong>reported</strong> in each part of
        Davis. Few or no reports in an area means it's{' '}
        <strong>under-reported</strong> — not that it's safe. Help close the gap
        by reporting what you see.
      </p>
      <ul className="coverage-list">
        {areas.map((a) => (
          <li key={a.name} className="coverage-row">
            <span className="coverage-area">{a.name}</span>
            <span
              className="coverage-bar"
              aria-hidden="true"
              style={{ width: `${max ? (a.count / max) * 100 : 0}%` }}
            />
            <span className="coverage-count">
              {a.count === 0
                ? 'No reports yet'
                : `${a.count} report${a.count === 1 ? '' : 's'}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
