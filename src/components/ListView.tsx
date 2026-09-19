/**
 * The accessible, non-map view of the same hazard data (map/list parity gate).
 * Fully keyboard- and screen-reader-operable; never depends on the map.
 */
import { FormattedMessage, useIntl } from 'react-intl';
import type { Hazard } from '../../shared/types.ts';
import { HazardCard } from './HazardCard.tsx';
import { feedErrorLabel } from '../i18n/labels.ts';
import type { ApiFailure } from '../lib/api.ts';
import { SkeletonList } from './Skeleton.tsx';
import { useLabels } from '../i18n/labels.ts';
import type { RecurrenceState } from '../hooks/useRecurrence.ts';

interface ListViewProps {
  hazards: Hazard[];
  loading: boolean;
  /**
   * Why the feed failed, as a code (issue #200). It used to be the thrown
   * `Error`'s message — the server's own English sentence — rendered verbatim
   * into the `role="alert"` below, under a translated heading.
   */
  error: ApiFailure | null;
  onConfirm?: (id: string) => void | Promise<boolean | void>;
  onFocusOnMap?: (hazard: Hazard) => void;
  onRetry?: () => void;
  /** Recurrence labels (issue #180); the map popup reads the same state. */
  recurrence?: RecurrenceState;
}

export function ListView({
  hazards,
  loading,
  error,
  onConfirm,
  onFocusOnMap,
  onRetry,
  recurrence,
}: ListViewProps) {
  const labels = useLabels();
  // Skeletons only on the very first load (when we have nothing to show yet);
  // a background refresh keeps the existing cards visible.
  const intl = useIntl();
  const showSkeleton = loading && hazards.length === 0 && !error;
  return (
    <section className="list-view" aria-label={intl.formatMessage({ id: 'list.aria', defaultMessage: 'Hazard list' })}>
      {showSkeleton && <SkeletonList />}
      {error && (
        <div role="alert" className="feed-error">
          <p className="error-text">{feedErrorLabel(intl, error)}</p>
          {onRetry && (
            <button type="button" className="btn btn-small" onClick={onRetry}>
              <FormattedMessage id="common.retry" defaultMessage="Retry" />
            </button>
          )}
        </div>
      )}
      {!loading && !error && hazards.length === 0 && (
        <p className="empty-state">
          <FormattedMessage
            id="list.empty"
            defaultMessage="No hazards match these filters. That means none have been <strong>reported</strong> here — not that the area is safe."
            values={{ strong: (chunks) => <strong>{chunks}</strong> }}
          />
        </p>
      )}
      {recurrence?.status === 'unavailable' && (
        <p className="hint recurrence-unavailable">{labels.recurrenceUnavailable()}</p>
      )}
      <ul className="hazard-list">
        {hazards.map((h) => (
          <HazardCard
            key={h.id}
            hazard={h}
            onConfirm={onConfirm}
            onFocusOnMap={onFocusOnMap}
            recurrence={recurrence?.status === 'published' ? (recurrence.badges.get(h.id) ?? null) : null}
          />
        ))}
      </ul>
    </section>
  );
}
