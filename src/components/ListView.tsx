/**
 * The accessible, non-map view of the same hazard data (map/list parity gate).
 * Fully keyboard- and screen-reader-operable; never depends on the map.
 */
import { FormattedMessage, useIntl } from 'react-intl';
import type { Hazard } from '../../shared/types.ts';
import { HazardCard } from './HazardCard.tsx';
import { SkeletonList } from './Skeleton.tsx';

interface ListViewProps {
  hazards: Hazard[];
  loading: boolean;
  error: string | null;
  onConfirm?: (id: string) => void;
  onFocusOnMap?: (hazard: Hazard) => void;
  onRetry?: () => void;
}

export function ListView({
  hazards,
  loading,
  error,
  onConfirm,
  onFocusOnMap,
  onRetry,
}: ListViewProps) {
  // Skeletons only on the very first load (when we have nothing to show yet);
  // a background refresh keeps the existing cards visible.
  const intl = useIntl();
  const showSkeleton = loading && hazards.length === 0 && !error;
  return (
    <section className="list-view" aria-label={intl.formatMessage({ id: 'list.aria', defaultMessage: 'Hazard list' })}>
      {showSkeleton && <SkeletonList />}
      {error && (
        <div role="alert" className="feed-error">
          <p className="error-text">{error}</p>
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
      <ul className="hazard-list">
        {hazards.map((h) => (
          <HazardCard
            key={h.id}
            hazard={h}
            onConfirm={onConfirm}
            onFocusOnMap={onFocusOnMap}
          />
        ))}
      </ul>
    </section>
  );
}
