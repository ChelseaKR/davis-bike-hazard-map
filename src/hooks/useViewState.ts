/**
 * The app shell's view state, consolidated into one reducer.
 *
 * App used to juggle four separate useState hooks (tab, filters, focusHazard, a
 * status-refresh counter) with several setters threaded through callbacks. A
 * reducer makes the transitions explicit and atomic — e.g. "focus this hazard
 * on the map" is a single action that both sets the focus and switches tabs —
 * and is unit-testable in isolation.
 *
 * The shareable parts (tab, filters, focused hazard) are mirrored into
 * `location.hash`, so every view is a copy-pasteable permalink and the
 * browser's back/forward buttons work. No router dependency — the reducer seam
 * is the integration point. URL scheme:
 *
 *   #/map · #/list · #/coverage · …   the active tab
 *   ?cat=a,b&severity=high&days=30    active filters, appended to any path
 *   #/route?profile=e-bike            the planner's rider preference (issue
 *                                     #178); route tab only, and omitted for
 *                                     `default`
 *   #/hazard/<id>                     a hazard deep link; held as
 *                                     `pendingHazardId` until the feed
 *                                     resolves it to focus-on-map (App.tsx)
 */
import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import {
  DEFAULT_ROUTE_PROFILE_ID,
  HAZARD_CATEGORIES,
  ROUTE_PROFILE_IDS,
  SEVERITIES,
  type Hazard,
  type HazardCategory,
  type HazardFilters,
  type RouteProfileId,
  type Severity,
} from '../../shared/types.ts';

export type Tab =
  | 'map'
  | 'list'
  | 'coverage'
  | 'trends'
  | 'route'
  | 'report'
  | 'mine'
  | 'moderate';

const TAB_VALUES: readonly Tab[] = [
  'map',
  'list',
  'coverage',
  'trends',
  'route',
  'report',
  'mine',
  'moderate',
];

export interface ViewState {
  tab: Tab;
  filters: HazardFilters;
  /** Hazard to fly to on the map, if any. */
  focusHazard: Hazard | null;
  /** Hazard id from a /#/hazard/:id deep link, awaiting the feed to resolve it. */
  pendingHazardId: string | null;
  /** Bumped to nudge queue-derived UI (StatusBanner) to re-read. */
  statusKey: number;
  /**
   * The route planner's rider preference (issue #178). Held here, not inside
   * RoutePlanner, so it is part of the permalink: `#/route?profile=e-bike` opens
   * the planner with that preference selected. It survives a tab switch in
   * memory but is serialized on the route tab only, because a map or list URL
   * carrying a routing preference would describe a view that has none.
   */
  routeProfile: RouteProfileId;
}

export type ViewAction =
  | { type: 'setTab'; tab: Tab }
  | { type: 'setFilters'; filters: HazardFilters }
  | { type: 'setRouteProfile'; profile: RouteProfileId }
  | { type: 'focusOnMap'; hazard: Hazard }
  | { type: 'hydrateFromHash'; hash: string }
  | { type: 'clearPendingHazard' }
  | { type: 'bumpStatus' };

export const initialViewState: ViewState = {
  tab: 'map',
  filters: {},
  focusHazard: null,
  pendingHazardId: null,
  statusKey: 0,
  routeProfile: DEFAULT_ROUTE_PROFILE_ID,
};

/** The view-state parts a location hash can express. */
export interface ParsedViewHash {
  tab?: Tab;
  filters?: HazardFilters;
  hazardId?: string;
  /** Only ever set for the route tab; see {@link ViewState.routeProfile}. */
  routeProfile?: RouteProfileId;
}

function isTab(value: string): value is Tab {
  return (TAB_VALUES as readonly string[]).includes(value);
}

function filtersToParams(filters: HazardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.categories?.length) params.set('cat', filters.categories.join(','));
  if (filters.minSeverity) params.set('severity', filters.minSeverity);
  if (filters.withinDays !== undefined) params.set('days', String(filters.withinDays));
  return params;
}

/**
 * The `profile` parameter, if it names a profile this build has. An array
 * membership test rather than an object lookup, so `constructor` and the other
 * inherited names are refused here exactly as `resolveRouteProfile` refuses them
 * (#199). An unknown value is dropped, as an invalid filter is: the picker then
 * shows the preference actually in force, and the result names the one the
 * server says it planned with, so nothing claims the link's value was used.
 */
function queryToRouteProfile(query: string): RouteProfileId | undefined {
  const value = new URLSearchParams(query).get('profile');
  return value !== null && (ROUTE_PROFILE_IDS as readonly string[]).includes(value)
    ? (value as RouteProfileId)
    : undefined;
}

function queryToFilters(query: string): HazardFilters | undefined {
  const params = new URLSearchParams(query);
  const filters: HazardFilters = {};
  const categories = (params.get('cat') ?? '')
    .split(',')
    .filter((c): c is HazardCategory => (HAZARD_CATEGORIES as readonly string[]).includes(c));
  if (categories.length) filters.categories = categories;
  const severity = params.get('severity');
  if (severity && (SEVERITIES as readonly string[]).includes(severity)) {
    filters.minSeverity = severity as Severity;
  }
  const days = Number(params.get('days'));
  if (Number.isFinite(days) && days > 0) filters.withinDays = days;
  return Object.keys(filters).length ? filters : undefined;
}

/** decodeURIComponent that tolerates malformed escapes in hand-edited URLs. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Serialize the shareable parts of the view state into a location hash, e.g.
 * `#/map?severity=high` or `#/hazard/<id>`. `statusKey` and the resolved
 * `focusHazard` object are deliberately not serialized — a focused hazard is
 * addressed by id alone so the permalink stays stable and small.
 */
export function serializeViewState(state: ViewState): string {
  const focusId = state.focusHazard?.id ?? state.pendingHazardId;
  const path =
    state.tab === 'map' && focusId ? `hazard/${encodeURIComponent(focusId)}` : state.tab;
  const params = filtersToParams(state.filters);
  // Route tab only, and never the default: a route link made before profiles
  // existed stays byte-identical, and a map URL carries no preference for a
  // planner it is not showing.
  if (state.tab === 'route' && state.routeProfile !== DEFAULT_ROUTE_PROFILE_ID) {
    params.set('profile', state.routeProfile);
  }
  const query = params.toString();
  return `#/${path}${query ? `?${query}` : ''}`;
}

/**
 * Parse a location hash back into view-state parts. Unknown tabs fall back to
 * 'map'; invalid filter values are dropped rather than propagated.
 */
export function parseHash(hash: string): ParsedViewHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf('?');
  const query = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
  const path = (queryIndex === -1 ? raw : raw.slice(0, queryIndex)).replace(/^\/+|\/+$/g, '');

  const parsed: ParsedViewHash = {};
  if (path.startsWith('hazard/')) {
    const id = safeDecode(path.slice('hazard/'.length));
    parsed.tab = 'map';
    if (id) parsed.hazardId = id;
  } else if (path) {
    parsed.tab = isTab(path) ? path : 'map';
  }
  const filters = queryToFilters(query);
  if (filters) parsed.filters = filters;
  if (parsed.tab === 'route') {
    const routeProfile = queryToRouteProfile(query);
    if (routeProfile) parsed.routeProfile = routeProfile;
  }
  return parsed;
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'setTab':
      return { ...state, tab: action.tab };
    case 'setFilters':
      return { ...state, filters: action.filters };
    case 'setRouteProfile':
      return state.routeProfile === action.profile
        ? state
        : { ...state, routeProfile: action.profile };
    case 'focusOnMap':
      // Focusing a hazard always brings the map forward (and satisfies any
      // pending deep link for it).
      return { ...state, focusHazard: action.hazard, pendingHazardId: null, tab: 'map' };
    case 'hydrateFromHash': {
      const parsed = parseHash(action.hash);
      const keepFocus =
        parsed.hazardId && state.focusHazard?.id === parsed.hazardId ? state.focusHazard : null;
      const next: ViewState = {
        ...state,
        tab: parsed.tab ?? 'map',
        filters: parsed.filters ?? {},
        focusHazard: keepFocus,
        pendingHazardId: parsed.hazardId && !keepFocus ? parsed.hazardId : null,
        // On the route tab the URL is the source of truth, and a link without
        // `profile` means the default. Anywhere else the URL says nothing about
        // the planner, so the in-memory preference is kept for when the rider
        // comes back to it.
        routeProfile:
          parsed.tab === 'route'
            ? (parsed.routeProfile ?? DEFAULT_ROUTE_PROFILE_ID)
            : state.routeProfile,
      };
      // Bail out (referential identity) when the hash already reflects the
      // state, so echoes of our own writes never cause a render loop.
      return serializeViewState(next) === serializeViewState(state) ? state : next;
    }
    case 'clearPendingHazard':
      return state.pendingHazardId ? { ...state, pendingHazardId: null } : state;
    case 'bumpStatus':
      return { ...state, statusKey: state.statusKey + 1 };
    default:
      return state;
  }
}

/** Lazy initializer: boot from the current URL so deep links work cold. */
function initViewState(): ViewState {
  if (typeof window === 'undefined') return initialViewState;
  const parsed = parseHash(window.location.hash);
  return {
    ...initialViewState,
    tab: parsed.tab ?? initialViewState.tab,
    filters: parsed.filters ?? initialViewState.filters,
    pendingHazardId: parsed.hazardId ?? null,
    routeProfile: parsed.routeProfile ?? initialViewState.routeProfile,
  };
}

export function useViewState(): [ViewState, Dispatch<ViewAction>] {
  const [state, dispatch] = useReducer(viewReducer, undefined, initViewState);

  // Mirror the state into the hash. The very first write only normalizes the
  // URL (e.g. "" → "#/map"), so it replaces instead of pushing a history
  // entry; every later change is a real navigation the back button can undo.
  const normalizedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = serializeViewState(state);
    if (window.location.hash === next) {
      normalizedRef.current = true;
      return;
    }
    if (normalizedRef.current) {
      window.history.pushState(null, '', next);
    } else {
      window.history.replaceState(null, '', next);
      normalizedRef.current = true;
    }
  }, [state]);

  // Back/forward (popstate) and manual hash edits (hashchange) rehydrate the
  // state; the reducer no-ops when the hash already matches.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNavigate = () => dispatch({ type: 'hydrateFromHash', hash: window.location.hash });
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    return () => {
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('hashchange', onNavigate);
    };
  }, []);

  return [state, dispatch];
}
