/**
 * The accessible, non-map view of the same hazard data (map/list parity gate).
 * Fully keyboard- and screen-reader-operable; never depends on the map.
 */
import type { Hazard } from '../../shared/types.ts';
import { HazardCard } from './HazardCard.tsx';

interface ListViewProps {
  hazards: Hazard[];
  loading: boolean;
  error: string | null;
  onConfirm?: (id: string) => void;
  onFocusOnMap?: (hazard: Hazard) => void;
}

export function ListView({
  hazards,
  loading,
  error,
  onConfirm,
  onFocusOnMap,
}: ListViewProps) {
  return (
    <section className="list-view" aria-label="Hazard list">
      {loading && <p className="hint">Loading hazards…</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!loading && !error && hazards.length === 0 && (
        <p className="empty-state">
          No hazards match these filters. That means none have been{' '}
          <strong>reported</strong> here — not that the area is safe.
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
