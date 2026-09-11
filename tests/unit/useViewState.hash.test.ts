/**
 * URL/navigation state (FIX-08): the view state round-trips through
 * `location.hash` so tabs, filters, and hazards are shareable permalinks and
 * the browser's back/forward buttons work.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  serializeViewState,
  parseHash,
  viewReducer,
  initialViewState,
  useViewState,
  type ViewState,
} from '../../src/hooks/useViewState.ts';
import { ROUTE_PROFILE_IDS, type Hazard } from '../../shared/types.ts';

const hazard = { id: 'h1' } as Hazard;

function state(over: Partial<ViewState> = {}): ViewState {
  return { ...initialViewState, ...over };
}

describe('serializeViewState', () => {
  it('serializes the default state to the map tab', () => {
    expect(serializeViewState(initialViewState)).toBe('#/map');
  });

  it('serializes the active tab', () => {
    expect(serializeViewState(state({ tab: 'coverage' }))).toBe('#/coverage');
  });

  it('encodes filters as query params', () => {
    const s = state({
      tab: 'list',
      filters: { categories: ['pothole', 'glass_debris'], minSeverity: 'high', withinDays: 30 },
    });
    expect(serializeViewState(s)).toBe('#/list?cat=pothole%2Cglass_debris&severity=high&days=30');
  });

  it('addresses a focused hazard by id only (not the object)', () => {
    expect(serializeViewState(state({ focusHazard: hazard }))).toBe('#/hazard/h1');
  });

  it('serializes a pending (not yet loaded) hazard deep link', () => {
    expect(serializeViewState(state({ pendingHazardId: 'abc' }))).toBe('#/hazard/abc');
  });

  it('keeps the tab authoritative when the user has navigated away from the map', () => {
    expect(serializeViewState(state({ tab: 'list', focusHazard: hazard }))).toBe('#/list');
  });

  it('never serializes statusKey', () => {
    expect(serializeViewState(state({ statusKey: 42 }))).toBe('#/map');
  });
});

describe('parseHash', () => {
  it('returns nothing for an empty or bare hash', () => {
    expect(parseHash('')).toEqual({});
    expect(parseHash('#')).toEqual({});
    expect(parseHash('#/')).toEqual({});
  });

  it('parses a tab', () => {
    expect(parseHash('#/route')).toEqual({ tab: 'route' });
  });

  it('falls back to the map tab for unknown paths', () => {
    expect(parseHash('#/bogus')).toEqual({ tab: 'map' });
  });

  it('parses a hazard deep link onto the map tab', () => {
    expect(parseHash('#/hazard/h1')).toEqual({ tab: 'map', hazardId: 'h1' });
  });

  it('decodes an encoded hazard id', () => {
    expect(parseHash('#/hazard/a%20b').hazardId).toBe('a b');
  });

  it('parses filters and drops invalid values', () => {
    expect(parseHash('#/list?cat=pothole,not_a_category&severity=high&days=30')).toEqual({
      tab: 'list',
      filters: { categories: ['pothole'], minSeverity: 'high', withinDays: 30 },
    });
    expect(parseHash('#/map?severity=nuclear&days=-3&cat=nope')).toEqual({ tab: 'map' });
  });

  it('round-trips a full view state', () => {
    const s = state({
      tab: 'list',
      filters: { categories: ['pothole', 'blocked_lane'], minSeverity: 'moderate', withinDays: 7 },
    });
    expect(parseHash(serializeViewState(s))).toEqual({
      tab: 'list',
      filters: s.filters,
    });
  });

  it('round-trips a hazard permalink with filters', () => {
    const s = state({ focusHazard: hazard, filters: { minSeverity: 'high' } });
    expect(parseHash(serializeViewState(s))).toEqual({
      tab: 'map',
      hazardId: 'h1',
      filters: { minSeverity: 'high' },
    });
  });
});

describe('viewReducer hash actions', () => {
  it('hydrateFromHash applies tab and filters', () => {
    const next = viewReducer(initialViewState, {
      type: 'hydrateFromHash',
      hash: '#/list?severity=high',
    });
    expect(next.tab).toBe('list');
    expect(next.filters).toEqual({ minSeverity: 'high' });
  });

  it('hydrateFromHash records a deep-linked hazard as pending', () => {
    const next = viewReducer(initialViewState, { type: 'hydrateFromHash', hash: '#/hazard/x9' });
    expect(next.tab).toBe('map');
    expect(next.pendingHazardId).toBe('x9');
    expect(next.focusHazard).toBeNull();
  });

  it('hydrateFromHash keeps an already-focused hazard matching the link', () => {
    const focused = state({ focusHazard: hazard });
    const next = viewReducer(focused, { type: 'hydrateFromHash', hash: '#/hazard/h1' });
    expect(next).toBe(focused); // hash already reflected — identity bail-out
  });

  it('hydrateFromHash is an identity no-op when the hash already matches', () => {
    const next = viewReducer(initialViewState, { type: 'hydrateFromHash', hash: '#/map' });
    expect(next).toBe(initialViewState);
  });

  it('focusOnMap satisfies a pending deep link', () => {
    const pending = state({ pendingHazardId: 'h1' });
    const next = viewReducer(pending, { type: 'focusOnMap', hazard });
    expect(next.focusHazard).toBe(hazard);
    expect(next.pendingHazardId).toBeNull();
  });

  it('clearPendingHazard drops an unresolvable deep link', () => {
    const pending = state({ pendingHazardId: 'gone' });
    expect(viewReducer(pending, { type: 'clearPendingHazard' }).pendingHazardId).toBeNull();
    expect(viewReducer(initialViewState, { type: 'clearPendingHazard' })).toBe(initialViewState);
  });
});

describe('useViewState hash integration', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('initializes from the current hash', () => {
    window.history.replaceState(null, '', '#/list?severity=high&days=30');
    const { result } = renderHook(() => useViewState());
    expect(result.current[0].tab).toBe('list');
    expect(result.current[0].filters).toEqual({ minSeverity: 'high', withinDays: 30 });
  });

  it('initializes a hazard deep link as pending', () => {
    window.history.replaceState(null, '', '#/hazard/abc');
    const { result } = renderHook(() => useViewState());
    expect(result.current[0].tab).toBe('map');
    expect(result.current[0].pendingHazardId).toBe('abc');
  });

  it('writes state changes to the hash', () => {
    const { result } = renderHook(() => useViewState());
    expect(window.location.hash).toBe('#/map'); // normalized on mount
    act(() => {
      result.current[1]({ type: 'setTab', tab: 'list' });
    });
    expect(window.location.hash).toBe('#/list');
    act(() => {
      result.current[1]({ type: 'setFilters', filters: { minSeverity: 'high' } });
    });
    expect(window.location.hash).toBe('#/list?severity=high');
  });

  it('rehydrates on popstate/hashchange (back/forward)', () => {
    const { result } = renderHook(() => useViewState());
    act(() => {
      result.current[1]({ type: 'setTab', tab: 'coverage' });
    });
    expect(result.current[0].tab).toBe('coverage');
    // Simulate the browser's back button restoring the previous entry.
    act(() => {
      window.history.replaceState(null, '', '#/map');
      window.dispatchEvent(new Event('popstate'));
    });
    expect(result.current[0].tab).toBe('map');
    act(() => {
      window.history.replaceState(null, '', '#/list?severity=moderate');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(result.current[0].tab).toBe('list');
    expect(result.current[0].filters).toEqual({ minSeverity: 'moderate' });
  });

  it('removes its navigation listeners on unmount', () => {
    const { unmount, result } = renderHook(() => useViewState());
    unmount();
    act(() => {
      window.history.replaceState(null, '', '#/coverage');
      window.dispatchEvent(new Event('popstate'));
    });
    expect(result.current[0].tab).toBe('map'); // unchanged after unmount
  });
});

describe('route preference in the permalink (issue #178)', () => {
  it('serializes a non-default preference on the route tab, and only there', () => {
    expect(serializeViewState(state({ tab: 'route', routeProfile: 'e-bike' }))).toBe(
      '#/route?profile=e-bike',
    );
    expect(serializeViewState(state({ tab: 'map', routeProfile: 'e-bike' }))).toBe('#/map');
    expect(serializeViewState(state({ tab: 'list', routeProfile: 'family-safest' }))).toBe(
      '#/list',
    );
  });

  it('omits the default, so every route link made before profiles existed is unchanged', () => {
    expect(serializeViewState(state({ tab: 'route' }))).toBe('#/route');
    expect(serializeViewState(state({ tab: 'route', routeProfile: 'default' }))).toBe('#/route');
  });

  it('appends the preference after any filters', () => {
    const s = state({ tab: 'route', routeProfile: 'family-safest', filters: { minSeverity: 'high' } });
    expect(serializeViewState(s)).toBe('#/route?severity=high&profile=family-safest');
  });

  it('parses a known preference on the route tab', () => {
    expect(parseHash('#/route?profile=family-safest')).toEqual({
      tab: 'route',
      routeProfile: 'family-safest',
    });
  });

  it('drops an unknown preference, including names every plain object inherits', () => {
    for (const value of ['family-safes', 'constructor', 'toString', '__proto__', '']) {
      expect(parseHash(`#/route?profile=${value}`), value).toEqual({ tab: 'route' });
    }
  });

  it('ignores a preference on any tab but the route tab', () => {
    expect(parseHash('#/map?profile=e-bike')).toEqual({ tab: 'map' });
    expect(parseHash('#/hazard/h1?profile=e-bike')).toEqual({ tab: 'map', hazardId: 'h1' });
  });

  it('round-trips every profile', () => {
    for (const routeProfile of ROUTE_PROFILE_IDS) {
      const parsed = parseHash(serializeViewState(state({ tab: 'route', routeProfile })));
      expect(parsed.routeProfile ?? 'default', routeProfile).toBe(routeProfile);
    }
  });

  it('setRouteProfile sets it, and returns the same state when nothing changed', () => {
    const next = viewReducer(initialViewState, { type: 'setRouteProfile', profile: 'e-bike' });
    expect(next.routeProfile).toBe('e-bike');
    expect(viewReducer(next, { type: 'setRouteProfile', profile: 'e-bike' })).toBe(next);
  });

  it('hydrating the route tab takes the URL as the source of truth', () => {
    const withBike = viewReducer(initialViewState, {
      type: 'hydrateFromHash',
      hash: '#/route?profile=e-bike',
    });
    expect(withBike.routeProfile).toBe('e-bike');
    // A route link without the parameter means the default, not "whatever was set before".
    expect(viewReducer(withBike, { type: 'hydrateFromHash', hash: '#/route' }).routeProfile).toBe(
      'default',
    );
  });

  it('hydrating another tab keeps the preference for when the rider comes back', () => {
    const onMap = viewReducer(state({ tab: 'route', routeProfile: 'e-bike' }), {
      type: 'hydrateFromHash',
      hash: '#/map',
    });
    expect(onMap.tab).toBe('map');
    expect(onMap.routeProfile).toBe('e-bike');
  });

  it('boots cold from a route link carrying a preference', () => {
    window.history.replaceState(null, '', '#/route?profile=family-safest');
    try {
      const { result } = renderHook(() => useViewState());
      expect(result.current[0].tab).toBe('route');
      expect(result.current[0].routeProfile).toBe('family-safest');
    } finally {
      window.history.replaceState(null, '', '#');
    }
  });
});
