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
import type { Hazard } from '../../shared/types.ts';

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
