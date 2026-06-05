import { useEffect } from 'react';

/**
 * Refresh the hazard feed when connectivity or foreground state is regained.
 *
 * The browser fires `online` after a reconnect, and `visibilitychange` when a
 * backgrounded PWA is brought back to the foreground — where `online` may never
 * fire because the socket never formally dropped. Either way the cached feed is
 * likely stale, so we refetch without the user having to pull to refresh. The
 * refresh is skipped while offline so we don't thrash a failing request.
 */
export function useRefreshOnReconnect(refresh: () => void): void {
  useEffect(() => {
    const maybeRefresh = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };
    window.addEventListener('online', maybeRefresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', maybeRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
}
