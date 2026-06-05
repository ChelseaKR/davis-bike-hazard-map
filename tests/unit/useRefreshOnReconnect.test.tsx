import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRefreshOnReconnect } from '../../src/hooks/useRefreshOnReconnect.ts';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

describe('useRefreshOnReconnect', () => {
  beforeEach(() => {
    setOnline(true);
    setVisibility('visible');
  });

  afterEach(() => {
    setOnline(true);
    setVisibility('visible');
  });

  it('refreshes when the browser comes back online', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReconnect(refresh));
    window.dispatchEvent(new Event('online'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the app is foregrounded while online', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReconnect(refresh));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while offline', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReconnect(refresh));
    setOnline(false);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores visibilitychange when the tab is hidden', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReconnect(refresh));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('detaches listeners on unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnReconnect(refresh));
    unmount();
    window.dispatchEvent(new Event('online'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
