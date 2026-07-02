/**
 * "My Reports" — the device-local queue and its sync state. Lets a cyclist see
 * what they've filed, retry a failed sync, or delete a report from their phone.
 *
 * Once a report has reached the server it also shows a live *feedback trail*
 * (reported → in review → on the map → handed to the city → fixed), fetched by
 * the report's clientId (research roadmap R2), so a report is never a black box.
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import { type Hazard } from '../../shared/types.ts';
import {
  deleteReport,
  getAllReports,
  type QueuedReport,
} from '../lib/db.ts';
import {
  deleteReport as deleteReportFromServer,
  fetchReportStatus,
} from '../lib/api.ts';
import { syncOnce, isOnline } from '../lib/sync.ts';
import { timeAgo } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';
import { reportTrail } from '../lib/reportTrail.ts';

/** Screen-reader text for each trail step's state (the visual cue is colour). */
const trailStateMessages = defineMessages({
  done: { id: 'myReports.trail.state.done', defaultMessage: 'done' },
  current: { id: 'myReports.trail.state.current', defaultMessage: 'in progress' },
  upcoming: { id: 'myReports.trail.state.upcoming', defaultMessage: 'not started yet' },
  rejected: { id: 'myReports.trail.state.rejected', defaultMessage: 'not approved' },
});

export function MyReports({ onChange }: { onChange?: () => void }) {
  const intl = useIntl();
  const labels = useLabels();
  const [reports, setReports] = useState<QueuedReport[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Hazard | null>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all = await getAllReports();
    setReports(all);
    // Best-effort: pull the server-side status of every report that reached the
    // server, so we can show its review/lifecycle trail. Failures (offline, a
    // deleted record) just leave the trail off — the local state still shows.
    const synced = all.filter((r) => r.state === 'synced');
    const entries = await Promise.all(
      synced.map(async (r) => {
        try {
          return [r.clientId, await fetchReportStatus(r.clientId)] as const;
        } catch {
          return [r.clientId, null] as const;
        }
      }),
    );
    setStatuses(Object.fromEntries(entries));
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

  const remove = async (report: QueuedReport) => {
    // Remove from this device, and — if it reached the server — ask the server
    // to delete the record + photos too (your clientId is the capability).
    await deleteReport(report.clientId);
    if (report.state === 'synced') {
      try {
        await deleteReportFromServer(report.clientId);
      } catch {
        // Best-effort: the local copy is gone regardless.
      }
    }
    await load();
    onChange?.();
  };

  const ariaLabel = intl.formatMessage({ id: 'myReports.aria', defaultMessage: 'My reports' });

  if (reports.length === 0) {
    return (
      <section className="my-reports" aria-label={ariaLabel}>
        <p className="empty-state">
          <FormattedMessage
            id="myReports.empty"
            defaultMessage="You haven't filed any hazards yet. Reports you make are saved here even when you're offline."
          />
        </p>
      </section>
    );
  }

  const hasPending = reports.some((r) => r.state === 'queued' || r.state === 'error');

  return (
    <section className="my-reports" aria-label={ariaLabel}>
      {hasPending && (
        <button
          type="button"
          className="btn"
          onClick={retry}
          disabled={busy || !isOnline()}
        >
          {busy ? (
            <FormattedMessage id="common.syncing" defaultMessage="Syncing…" />
          ) : isOnline() ? (
            <FormattedMessage id="myReports.syncNow" defaultMessage="Sync now" />
          ) : (
            <FormattedMessage id="myReports.offline" defaultMessage="Offline" />
          )}
        </button>
      )}
      <ul className="my-reports-list">
        {reports.map((r) => {
          const status = r.state === 'synced' ? statuses[r.clientId] : undefined;
          return (
            <li key={r.clientId} className={`my-report state-${r.state}`}>
              <div className="my-report-head">
                <strong>{labels.category(r.submission.category)}</strong>
                <span className={`pill pill-${r.state}`}>{labels.queueState(r.state)}</span>
              </div>
              <p className="hint">
                <FormattedMessage
                  id="myReports.meta"
                  defaultMessage="{severity} severity · filed {when}"
                  values={{
                    severity: labels.severity(r.submission.severity),
                    when: timeAgo(r.createdAt),
                  }}
                />
              </p>
              {r.state === 'error' && r.lastError && (
                <p className="error-text">{r.lastError}</p>
              )}
              {status && (
                <ol
                  className="report-trail"
                  aria-label={intl.formatMessage({
                    id: 'myReports.trail.aria',
                    defaultMessage: 'Report progress',
                  })}
                >
                  {reportTrail(status).map((step) => (
                    <li
                      key={step.key}
                      className={`trail-step trail-${step.state}`}
                      aria-current={step.state === 'current' ? 'step' : undefined}
                    >
                      <span className="trail-label">
                        {step.label}
                        <span className="visually-hidden">
                          {' — '}
                          {intl.formatMessage(trailStateMessages[step.state])}
                        </span>
                      </span>
                      {step.detail && <span className="trail-detail">{step.detail}</span>}
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                className="btn btn-small"
                onClick={() => remove(r)}
              >
                {r.state === 'synced' ? (
                  <FormattedMessage id="myReports.delete.server" defaultMessage="Delete my report" />
                ) : (
                  <FormattedMessage
                    id="myReports.delete.device"
                    defaultMessage="Delete from this device"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
