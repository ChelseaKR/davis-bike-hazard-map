/**
 * useOnline — reactive online/offline status. The offline-first UX (sync queue,
 * status banner) depends on this flipping with the browser events and cleaning
 * up its listeners on unmount.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnline } from '../../src/hooks/useOnline.ts';

describe('useOnline', () => {
  it('initialises from navigator.onLine and reacts to online/offline events', () => {
    const { result } = renderHook(() => useOnline());
    expect(typeof result.current).toBe('boolean');

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('detaches its listeners on unmount (no leaks)', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnline());
    unmount();
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
    remove.mockRestore();
  });
});
