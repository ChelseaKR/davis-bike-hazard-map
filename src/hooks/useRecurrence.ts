/**
 * Recurrence labels for the hazards on the map (issue #180), keyed by hazard id.
 *
 * Four states, kept apart because each tells a rider something different:
 *
 *   loading      nothing is shown yet.
 *   unpublished  this deployment does not publish labels (the default). Nothing
 *                is shown, and nothing is said: it is a configuration, not a fault.
 *   unavailable  labels could not be loaded. Nothing is shown, and the list and the
 *                map SAY so, because a hazard without a label would otherwise read
 *                as "never reported here before".
 *   published    the labels, possibly none.
 *
 * Both the list card and the map popup render from this one state, so the two
 * surfaces cannot disagree about a hazard.
 */
import { useEffect, useState } from 'react';
import type { RecurrenceBadge } from '../../shared/recurrence.ts';
import { fetchRecurrence } from '../lib/api.ts';

export type RecurrenceState =
  | { status: 'loading' }
  | { status: 'unpublished' }
  | { status: 'unavailable' }
  | { status: 'published'; badges: ReadonlyMap<string, RecurrenceBadge> };

/**
 * A label the page can print without inventing anything: an id, a whole number of
 * episodes that is a recurrence (two or more), and a real month. The body is a
 * network response, so its type is a claim about what the server wrote; a label
 * that fails this is dropped rather than printed as "NaN episodes since Invalid Date".
 */
export function isPrintableBadge(b: RecurrenceBadge): boolean {
  return (
    typeof b.hazardId === 'string' &&
    Number.isInteger(b.episodes) &&
    b.episodes >= 2 &&
    typeof b.since === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(b.since)
  );
}

export function useRecurrence(refreshKey: unknown): RecurrenceState {
  const [state, setState] = useState<RecurrenceState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchRecurrence().then(
      (badges) => {
        if (cancelled) return;
        setState(
          badges === null
            ? { status: 'unpublished' }
            : !Array.isArray(badges)
              ? { status: 'unavailable' }
              : {
                status: 'published',
                badges: new Map(badges.filter(isPrintableBadge).map((b) => [b.hazardId, b])),
              },
        );
      },
      () => {
        if (!cancelled) setState({ status: 'unavailable' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
