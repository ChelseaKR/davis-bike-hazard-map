/**
 * Loading placeholders. A shimmering skeleton reads as "content is coming"
 * better than a bare "Loading…" line, and respects reduced-motion (the shimmer
 * animation is dropped by the global motion media query).
 */

/** A list of placeholder hazard cards, shown while the first feed loads. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <ul className="hazard-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="hazard-card skeleton-card">
          <div className="skeleton skeleton-line skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-short" />
        </li>
      ))}
    </ul>
  );
}

/** A full-bleed placeholder for the lazy-loaded map canvas. */
export function SkeletonMap() {
  return <div className="skeleton skeleton-map" aria-hidden="true" />;
}
