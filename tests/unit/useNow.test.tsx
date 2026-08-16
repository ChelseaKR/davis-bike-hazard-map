/**
 * The ticking clock behind every relative time in the UI, and the guard that
 * keeps the next component from reintroducing a frozen one.
 *
 * The defect this covers: `timeAgo` reads `Date.now()` when it is called, and
 * React does not re-render on the passage of time, so "Updated 2 min ago" on a
 * map left open stayed "2 min ago" for the rest of the session.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/react';
import { useNow, RELATIVE_TIME_TICK_MS } from '../../src/lib/useNow.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('advances on its own after one tick, with no re-render from the caller', () => {
    vi.useFakeTimers();
    const start = new Date('2026-08-15T12:00:00Z').getTime();
    vi.setSystemTime(start);

    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    act(() => {
      vi.advanceTimersByTime(RELATIVE_TIME_TICK_MS);
    });
    expect(result.current).toBe(start + RELATIVE_TIME_TICK_MS);

    act(() => {
      vi.advanceTimersByTime(RELATIVE_TIME_TICK_MS * 3);
    });
    expect(result.current).toBe(start + RELATIVE_TIME_TICK_MS * 4);
  });

  it('ticks at timeAgo granularity — one minute, not faster', () => {
    expect(RELATIVE_TIME_TICK_MS).toBe(60_000);
  });

  it('pins to an override and installs no timer, so tests stay deterministic', () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z').getTime());

    const { result } = renderHook(() => useNow(1_700_000_000_000));
    expect(result.current).toBe(1_700_000_000_000);

    act(() => {
      vi.advanceTimersByTime(RELATIVE_TIME_TICK_MS * 10);
    });
    expect(result.current).toBe(1_700_000_000_000);
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('clears its interval on unmount', () => {
    vi.useFakeTimers();
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(clearInterval).toHaveBeenCalled();
  });
});

/** Top-level (paren-balanced) argument count of each `timeAgo(...)` call in `source`. */
function timeAgoArity(source: string): number[] {
  const arities: number[] = [];
  const call = /\btimeAgo\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    let depth = 1;
    let commas = 0;
    let index = match.index + match[0].length;
    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === ',' && depth === 1) commas += 1;
    }
    arities.push(commas + 1);
  }
  return arities;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('every timeAgo caller passes a clock', () => {
  // format.ts declares the default; useNow.ts only names it in prose.
  const exempt = new Set([join('src', 'lib', 'format.ts'), join('src', 'lib', 'useNow.ts')]);

  it('finds no bare timeAgo(x) anywhere in src/', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !exempt.has(file))
      .flatMap((file) =>
        timeAgoArity(readFileSync(file, 'utf8'))
          .map((arity, callIndex) => ({ file, arity, callIndex }))
          .filter(({ arity }) => arity < 2)
          .map(({ file: f, callIndex }) => `${f} (call #${callIndex + 1})`),
      );

    expect(
      offenders,
      'timeAgo() without an explicit clock freezes at the moment it is called; ' +
        'thread useNow() (components) or an explicit now parameter (plain functions)',
    ).toEqual([]);
  });

  it('proves the guard can fail', () => {
    expect(timeAgoArity('const a = timeAgo(x);')).toEqual([1]);
    expect(timeAgoArity('const a = timeAgo(x, now);')).toEqual([2]);
    expect(timeAgoArity('timeAgo(f(a, b), now)')).toEqual([2]);
    expect(timeAgoArity('timeAgo(obj.at ? { a, b } : c)')).toEqual([1]);
  });
});
