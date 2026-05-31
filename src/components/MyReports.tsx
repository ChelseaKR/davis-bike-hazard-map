/**
 * "My Reports" — the device-local queue and its sync state. Lets a cyclist see
 * what they've filed, retry a failed sync, or delete a report from their phone.
 */
import { useCallback, useEffect, useState } from 'react';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '../../shared/types.ts';
import {
  deleteReport,
  getAllReports,
  type QueuedReport,
  type QueueState,
} from '../lib/db.ts';
import { syncOnce, isOnline } from '../lib/sync.ts';
import { timeAgo } from '../lib/format.ts';

const STATE_LABEL: Record<QueueState, string> = {
  queued: 'Waiting to sync',
  syncing: 'Syncing…',
  synced: 'On the map (pending moderation)',
  error: "Couldn't sync",
};

export function MyReports({ onChange }: { onChange?: () => void }) {
  const [reports, setReports] = useState<QueuedReport[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setReports(await getAllReports());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async () => {
    setBusy(true);
    await syncOnce();
    await load();
    onChange?.();
    setBusy(false);
  };

  const remove = async (clientId: string) => {
    await deleteReport(clientId);
    await load();
    onChange?.();
  };

  if (reports.length === 0) {
    return (
      <section className="my-reports" aria-label="My reports">
        <p className="empty-state">
          You haven't filed any hazards yet. Reports you make are saved here even
          when you're offline.
        </p>
      </section>
    );
  }

  const hasPending = reports.some((r) => r.state === 'queued' || r.state === 'error');

  return (
    <section className="my-reports" aria-label="My reports">
      {hasPending && (
        <button
          type="button"
          className="btn"
          onClick={retry}
          disabled={busy || !isOnline()}
        >
          {busy ? 'Syncing…' : isOnline() ? 'Sync now' : 'Offline'}
        </button>
      )}
      <ul className="my-reports-list">
        {reports.map((r) => (
          <li key={r.clientId} className={`my-report state-${r.state}`}>
            <div className="my-report-head">
              <strong>{CATEGORY_LABELS[r.submission.category]}</strong>
              <span className={`pill pill-${r.state}`}>{STATE_LABEL[r.state]}</span>
            </div>
            <p className="hint">
              {SEVERITY_LABELS[r.submission.severity]} severity · filed{' '}
              {timeAgo(r.createdAt)}
            </p>
            {r.state === 'error' && r.lastError && (
              <p className="error-text">{r.lastError}</p>
            )}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => remove(r.clientId)}
            >
              Delete from this device
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
