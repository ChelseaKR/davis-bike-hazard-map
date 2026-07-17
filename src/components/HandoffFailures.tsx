/**
 * Dead-letter surface for 311 hand-offs (R3).
 *
 * A hand-off whose delivery failed through every automatic retry must not
 * vanish silently — that failure mode is the research roadmap's top
 * abandonment driver (EV-ABANDON). This panel shows each stuck hand-off with
 * its receipt (attempts, last error) and lets the moderator re-send it, which
 * records a fresh delivery attempt server-side.
 *
 * Renders nothing when there are no failures (the healthy state) so the
 * moderation panel stays uncluttered.
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  fetchHandoffFailures,
  retryHandoff,
  type HandoffFailure,
} from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';

export function HandoffFailures({ token }: { token: string }) {
  const intl = useIntl();
  const labels = useLabels();
  const [failures, setFailures] = useState<HandoffFailure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailures(await fetchHandoffFailures(token));
      setError(null);
    } catch {
      setError(
        intl.formatMessage({
          id: 'handoffFailures.error.load',
          defaultMessage: 'Could not load failed 311 hand-offs.',
        }),
      );
    }
  }, [token, intl]);

  useEffect(() => {
    void load();
  }, [load]);

  const resend = async (id: string) => {
    setBusy(true);
    try {
      await retryHandoff(id, token);
      await load();
    } catch {
      setError(
        intl.formatMessage({
          id: 'handoffFailures.error.retry',
          defaultMessage: 'Could not re-send that hand-off. Try again.',
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  if (failures.length === 0 && !error) return null;

  return (
    <section
      className="handoff-failures"
      aria-label={intl.formatMessage({
        id: 'handoffFailures.aria',
        defaultMessage: 'Failed 311 hand-offs',
      })}
    >
      <h3>
        <FormattedMessage
          id="handoffFailures.heading"
          defaultMessage="Failed 311 hand-offs ({count})"
          values={{ count: failures.length }}
        />
      </h3>
      <p className="hint">
        <FormattedMessage
          id="handoffFailures.hint"
          defaultMessage="Delivery to 311 kept failing for these reports, so automatic retries have stopped. Re-send to try again."
        />
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <ul className="moderation-list">
        {failures.map(({ hazard, delivery }) => (
          <li key={hazard.id} className="moderation-item">
            <div className="moderation-item-head">
              <strong>{labels.category(hazard.category)}</strong>
              <span className={`severity-text severity-text-${hazard.severity}`}>
                {labels.severity(hazard.severity)}
              </span>
              {delivery && (
                <span className="hint">
                  <FormattedMessage
                    id="handoffFailures.lastTried"
                    defaultMessage="{attempts, plural, one {# attempt} other {# attempts}}, last tried {when}"
                    values={{
                      attempts: delivery.attempts,
                      when: timeAgo(delivery.lastAttemptAt),
                    }}
                  />
                </span>
              )}
            </div>
            {delivery?.lastError && <p className="error-text">{delivery.lastError}</p>}
            <div className="moderation-actions">
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => void resend(hazard.id)}
              >
                <FormattedMessage id="handoffFailures.resend" defaultMessage="Re-send to 311" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
