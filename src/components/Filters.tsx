/**
 * Filter controls shared by the map and list views, so both always present the
 * same dataset (map/list parity is an accessibility gate).
 */
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  type HazardCategory,
  type HazardFilters,
  type Severity,
} from '../../shared/types.ts';
import { useLabels } from '../i18n/labels.ts';

interface FiltersProps {
  value: HazardFilters;
  onChange: (next: HazardFilters) => void;
  resultCount: number;
}

const recencyMessages = defineMessages({
  any: { id: 'filters.recency.any', defaultMessage: 'Any time' },
  week: { id: 'filters.recency.week', defaultMessage: 'Past week' },
  month: { id: 'filters.recency.month', defaultMessage: 'Past month' },
  quarter: { id: 'filters.recency.quarter', defaultMessage: 'Past 3 months' },
});

const RECENCY_OPTIONS = [
  { key: 'any', label: recencyMessages.any, value: undefined },
  { key: 'week', label: recencyMessages.week, value: 7 },
  { key: 'month', label: recencyMessages.month, value: 30 },
  { key: 'quarter', label: recencyMessages.quarter, value: 90 },
] as const;

export function Filters({ value, onChange, resultCount }: FiltersProps) {
  const intl = useIntl();
  const labels = useLabels();
  const toggleCategory = (cat: HazardCategory) => {
    const current = new Set(value.categories ?? []);
    if (current.has(cat)) current.delete(cat);
    else current.add(cat);
    onChange({ ...value, categories: current.size ? [...current] : undefined });
  };

  return (
    <section className="filters" aria-label={intl.formatMessage({ id: 'filters.aria', defaultMessage: 'Filter hazards' })}>
      <fieldset className="filter-group">
        <legend>
          <FormattedMessage id="filters.type" defaultMessage="Type" />
        </legend>
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
                {labels.category(cat)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="filter-row">
        <label htmlFor="minSeverity">
          <FormattedMessage id="filters.minSeverity" defaultMessage="Minimum severity" />
        </label>
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
          <option value="">{intl.formatMessage({ id: 'filters.severity.any', defaultMessage: 'Any' })}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {intl.formatMessage(
                { id: 'filters.severity.atLeast', defaultMessage: '{severity}+' },
                { severity: labels.severity(s) },
              )}
            </option>
          ))}
        </select>

        <label htmlFor="withinDays">
          <FormattedMessage id="filters.reported" defaultMessage="Reported" />
        </label>
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
            <option key={o.key} value={o.value ?? ''}>
              {intl.formatMessage(o.label)}
            </option>
          ))}
        </select>
      </div>

      <p className="filter-count" role="status" aria-live="polite">
        <FormattedMessage
          id="filters.count"
          defaultMessage="{count, plural, one {# hazard shown} other {# hazards shown}}"
          values={{ count: resultCount }}
        />
      </p>
    </section>
  );
}
