/**
 * Filter controls shared by the map and list views, so both always present the
 * same dataset (map/list parity is an accessibility gate).
 */
import {
  CATEGORY_LABELS,
  HAZARD_CATEGORIES,
  SEVERITIES,
  SEVERITY_LABELS,
  type HazardCategory,
  type HazardFilters,
  type Severity,
} from '../../shared/types.ts';

interface FiltersProps {
  value: HazardFilters;
  onChange: (next: HazardFilters) => void;
  resultCount: number;
}

const RECENCY_OPTIONS = [
  { label: 'Any time', value: undefined },
  { label: 'Past week', value: 7 },
  { label: 'Past month', value: 30 },
  { label: 'Past 3 months', value: 90 },
] as const;

export function Filters({ value, onChange, resultCount }: FiltersProps) {
  const toggleCategory = (cat: HazardCategory) => {
    const current = new Set(value.categories ?? []);
    if (current.has(cat)) current.delete(cat);
    else current.add(cat);
    onChange({ ...value, categories: current.size ? [...current] : undefined });
  };

  return (
    <section className="filters" aria-label="Filter hazards">
      <fieldset className="filter-group">
        <legend>Type</legend>
        <div className="chip-row">
          {HAZARD_CATEGORIES.map((cat) => {
            const active = value.categories?.includes(cat) ?? false;
            return (
              <label key={cat} className={`chip ${active ? 'chip-on' : ''}`}>
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={active}
                  onChange={() => toggleCategory(cat)}
                />
                {CATEGORY_LABELS[cat]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="filter-row">
        <label htmlFor="minSeverity">Minimum severity</label>
        <select
          id="minSeverity"
          value={value.minSeverity ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              minSeverity: (e.target.value || undefined) as Severity | undefined,
            })
          }
        >
          <option value="">Any</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}+
            </option>
          ))}
        </select>

        <label htmlFor="withinDays">Reported</label>
        <select
          id="withinDays"
          value={value.withinDays ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              withinDays: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        >
          {RECENCY_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <p className="filter-count" role="status" aria-live="polite">
        {resultCount} hazard{resultCount === 1 ? '' : 's'} shown
      </p>
    </section>
  );
}
