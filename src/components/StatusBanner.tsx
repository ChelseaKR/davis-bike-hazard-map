/**
 * A small, polite status strip: online/offline and how many reports are still
 * queued on this device. Uses role="status" so screen readers announce changes.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
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
      {!online && (
        <span>
          <FormattedMessage
            id="status.offline"
            defaultMessage="Offline — reports are saved on your device."
          />
        </span>
      )}
      {pending > 0 && (
        <span>
          {' '}
          <FormattedMessage
            id="status.pending"
            defaultMessage="{count, plural, one {# report waiting to sync.} other {# reports waiting to sync.}}"
            values={{ count: pending }}
          />
        </span>
      )}
      {failed > 0 && (
        <span className="status-error">
          {' '}
          <FormattedMessage
            id="status.failed"
            defaultMessage="{count, plural, one {# report couldn't sync — check My Reports.} other {# reports couldn't sync — check My Reports.}}"
            values={{ count: failed }}
          />
        </span>
      )}
    </div>
  );
}
