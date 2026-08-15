/**
 * One clock for every relative time the UI renders.
 *
 * `timeAgo(t)` reads `Date.now()` once, at the moment it is called. React does
 * not re-render on the passage of time, so a component that calls it and then
 * sits there — which is exactly how a map left open on a handlebar mount is
 * used — shows "Updated 2 min ago" for the rest of the session. Before this
 * hook, `FeedFreshness` and `HazardCard` each sampled `useState(Date.now)` at
 * mount (frozen, and only movable by a test-only `now` prop), while
 * `MapView`, `ModerationPanel`, `MyReports`, and `HandoffFailures` passed no
 * clock at all — two conventions for the same thing and no rule saying which
 * to use.
 *
 * `useNow` is that rule. It seeds from the real clock, ticks on an interval,
 * and cleans up on unmount.
 *
 * The tick is one minute because that is `timeAgo`'s own finest granularity
 * (`src/lib/format.ts` steps at minutes, hours, days, weeks, months). Anything
 * faster costs a re-render for a string that cannot have changed.
 */
import { useEffect, useState } from 'react';

/** `timeAgo`'s finest step, so the tick and the text agree. */
export const RELATIVE_TIME_TICK_MS = 60_000;

/**
 * Current epoch-ms, re-read every `intervalMs`.
 *
 * @param override Pin the clock instead of ticking. Tests pass this, and the
 *   components that already accepted a `now` prop forward it here, so their
 *   existing deterministic assertions keep working. No timer is installed
 *   while an override is present.
 */
export function useNow(
  override?: number,
  intervalMs: number = RELATIVE_TIME_TICK_MS,
): number {
  const [now, setNow] = useState(() => override ?? Date.now());

  useEffect(() => {
    if (override !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [override, intervalMs]);

  return override ?? now;
}
