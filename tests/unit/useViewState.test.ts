import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState } from '../../src/hooks/useViewState.ts';
import type { Hazard } from '../../shared/types.ts';

const hazard = { id: 'h1' } as Hazard;

describe('viewReducer', () => {
  it('switches tabs', () => {
    expect(viewReducer(initialViewState, { type: 'setTab', tab: 'list' }).tab).toBe('list');
  });

  it('sets filters', () => {
    const next = viewReducer(initialViewState, {
      type: 'setFilters',
      filters: { minSeverity: 'high' },
    });
    expect(next.filters).toEqual({ minSeverity: 'high' });
  });

  it('focusing a hazard also brings the map forward', () => {
    const fromList = { ...initialViewState, tab: 'list' as const };
    const next = viewReducer(fromList, { type: 'focusOnMap', hazard });
    expect(next.focusHazard).toBe(hazard);
    expect(next.tab).toBe('map');
  });

  it('bumpStatus increments the status key', () => {
    expect(viewReducer(initialViewState, { type: 'bumpStatus' }).statusKey).toBe(1);
  });

  it('does not mutate the previous state', () => {
    const before = { ...initialViewState };
    viewReducer(initialViewState, { type: 'bumpStatus' });
    expect(initialViewState).toEqual(before);
  });
});
