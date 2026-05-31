/**
 * A small, polite status strip: online/offline and how many reports are still
 * queued on this device. Uses role="status" so screen readers announce changes.
 */
import { useEffect, useState } from 'react';
import { useOnline } from '../hooks/useOnline.ts';
import { countByState, type QueueState } from '../lib/db.ts';

const EMPTY: Record<QueueState, number> = {
  queued: 0,
  syncing: 0,
  synced: 0,
  error: 0,
};

export function StatusBanner({ refreshKey = 0 }: { refreshKey?: number }) {
  const online = useOnline();
  const [counts, setCounts] = useState<Record<QueueState, number>>(EMPTY);

  useEffect(() => {
    let alive = true;
    countByState()
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setCounts(EMPTY));
    return () => {
      alive = false;
    };
  }, [refreshKey, online]);

  const pending = counts.queued + counts.syncing;
  const failed = counts.error;

  if (online && pending === 0 && failed === 0) return null;

  return (
    <div
      className={`status-banner ${online ? 'status-online' : 'status-offline'}`}
      role="status"
    >
      {!online && <span>Offline — reports are saved on your device.</span>}
      {pending > 0 && (
        <span>
          {' '}
          {pending} report{pending === 1 ? '' : 's'} waiting to sync.
        </span>
      )}
      {failed > 0 && (
        <span className="status-error">
          {' '}
          {failed} report{failed === 1 ? '' : 's'} couldn't sync — check My Reports.
        </span>
      )}
    </div>
  );
}
