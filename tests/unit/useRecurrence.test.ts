/**
 * useRecurrence (issue #180): four states a rider is owed the difference between,
 * and labels the page could not print honestly are dropped, not printed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { isPrintableBadge, useRecurrence } from '../../src/hooks/useRecurrence.ts';
import type { RecurrenceBadge } from '../../shared/recurrence.ts';

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const BADGE: RecurrenceBadge = { hazardId: 'h1', episodes: 3, since: '2026-01' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useRecurrence', () => {
  it('holds published labels by hazard id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ badges: [BADGE] })));
    const { result } = renderHook(() => useRecurrence(1));
    await waitFor(() => expect(result.current.status).toBe('published'));
    const state = result.current;
    expect(state.status === 'published' && state.badges.get('h1')).toEqual(BADGE);
  });

  it('reads a not_published 404 as "not published", which is not a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resp({ error: 'not_published', message: 'off' }, 404)),
    );
    const { result } = renderHook(() => useRecurrence(1));
    await waitFor(() => expect(result.current.status).toBe('unpublished'));
  });

  it.each([
    ['the network failed', () => Promise.reject(new TypeError('offline'))],
    ['the server failed', async () => resp({ error: 'internal', message: 'boom' }, 500)],
    ['the route does not exist on this server', async () => resp({ error: 'Not Found' }, 404)],
  ])('reads it as unavailable when %s', async (_why, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    const { result } = renderHook(() => useRecurrence(1));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('drops a label it could not print honestly, and keeps the rest', async () => {
    const malformed = [
      { hazardId: 'one-episode', episodes: 1, since: '2026-01' },
      { hazardId: 'fractional', episodes: 2.5, since: '2026-01' },
      { hazardId: 'month-13', episodes: 3, since: '2026-13' },
      { hazardId: 'no-month', episodes: 3 },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => resp({ badges: [...malformed, BADGE] })));
    const { result } = renderHook(() => useRecurrence(1));
    await waitFor(() => expect(result.current.status).toBe('published'));
    const state = result.current;
    expect(state.status === 'published' && [...state.badges.keys()]).toEqual(['h1']);
  });

  it('asks again when the feed is refreshed', async () => {
    const asked: unknown[] = [];
    const fetchMock = vi.fn(async (...args: unknown[]) => {
      asked.push(args[0]);
      return resp({ badges: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ key }) => useRecurrence(key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current.status).toBe('published'));
    rerender({ key: 2 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(asked[1]).toBe('/api/hazards/recurrence');
  });
});

describe('isPrintableBadge', () => {
  it('accepts a whole number of episodes of at least two and a real month', () => {
    expect(isPrintableBadge(BADGE)).toBe(true);
    expect(isPrintableBadge({ ...BADGE, since: '2026-12' })).toBe(true);
    expect(isPrintableBadge({ ...BADGE, since: '2026-00' })).toBe(false);
    expect(isPrintableBadge({ ...BADGE, episodes: 1 })).toBe(false);
  });
});
