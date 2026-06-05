/**
 * The app shell's view state, consolidated into one reducer.
 *
 * App used to juggle four separate useState hooks (tab, filters, focusHazard, a
 * status-refresh counter) with several setters threaded through callbacks. A
 * reducer makes the transitions explicit and atomic — e.g. "focus this hazard
 * on the map" is a single action that both sets the focus and switches tabs —
 * and is unit-testable in isolation.
 */
import { useReducer, type Dispatch } from 'react';
import type { Hazard, HazardFilters } from '../../shared/types.ts';

export type Tab = 'map' | 'list' | 'report' | 'mine' | 'moderate';

export interface ViewState {
  tab: Tab;
  filters: HazardFilters;
  /** Hazard to fly to on the map, if any. */
  focusHazard: Hazard | null;
  /** Bumped to nudge queue-derived UI (StatusBanner) to re-read. */
  statusKey: number;
}

export type ViewAction =
  | { type: 'setTab'; tab: Tab }
  | { type: 'setFilters'; filters: HazardFilters }
  | { type: 'focusOnMap'; hazard: Hazard }
  | { type: 'bumpStatus' };

export const initialViewState: ViewState = {
  tab: 'map',
  filters: {},
  focusHazard: null,
  statusKey: 0,
};

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'setTab':
      return { ...state, tab: action.tab };
    case 'setFilters':
      return { ...state, filters: action.filters };
    case 'focusOnMap':
      // Focusing a hazard always brings the map forward.
      return { ...state, focusHazard: action.hazard, tab: 'map' };
    case 'bumpStatus':
      return { ...state, statusKey: state.statusKey + 1 };
    default:
      return state;
  }
}

export function useViewState(): [ViewState, Dispatch<ViewAction>] {
  return useReducer(viewReducer, initialViewState);
}
