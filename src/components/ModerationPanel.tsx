/**
 * Lightweight moderation queue. Nothing reaches the public map until a
 * moderator approves it here (the "no unmoderated public photo feed" gate).
 *
 * Auth is a per-moderator account: the moderator signs in with a username and
 * password, the server returns a signed, expiring session token, and that token
 * is sent as the bearer on every moderation call. The session is kept in
 * localStorage so a refresh doesn't force a re-login; "Sign out" clears it.
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { Hazard } from '../../shared/types.ts';
import {
  decideModeration,
  fetchModerationQueue,
  login,
  ApiRequestError,
  type Session,
} from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';
import { HazardPhoto } from './HazardPhoto.tsx';

const SESSION_KEY = 'dbhm.session';

function loadStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // Drop a session the client already knows is expired.
    return s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function ModerationPanel() {
  const intl = useIntl();
  const labels = useLabels();
  const [session, setSession] = useState<Session | null>(loadStoredSession);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [queue, setQueue] = useState<Hazard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback((message?: string) => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setQueue([]);
    setPassword('');
    if (message) setError(message);
  }, []);

  const load = useCallback(
    async (tok: string) => {
      setBusy(true);
      setError(null);
      try {
        setQueue(await fetchModerationQueue(tok));
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          signOut(
            intl.formatMessage({
              id: 'moderation.error.sessionExpired',
              defaultMessage: 'Your session expired. Please sign in again.',
            }),
          );
        } else {
          setError(
            intl.formatMessage({
              id: 'moderation.error.loadQueue',
              defaultMessage: 'Could not load the queue. Try again.',
            }),
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [signOut, intl],
  );

  useEffect(() => {
    if (session) void load(session.token);
    // Load once on mount with a stored session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await login(username.trim(), password);
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      setPassword('');
      await load(s.token);
    } catch {
      setError(
        intl.formatMessage({
          id: 'moderation.error.badCredentials',
          defaultMessage: 'Wrong username or password.',
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    id: string,
    decision: 'approve' | 'reject' | 'resolve',
  ) => {
    if (!session) return;
    setBusy(true);
    try {
      await decideModeration(id, decision, session.token);
      setQueue((q) => q.filter((h) => h.id !== id));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        signOut(
          intl.formatMessage({
            id: 'moderation.error.sessionExpired',
            defaultMessage: 'Your session expired. Please sign in again.',
          }),
        );
      } else {
        setError(
          intl.formatMessage({
            id: 'moderation.error.decision',
            defaultMessage: 'Could not record that decision. Try again.',
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <section
        className="moderation"
        aria-label={intl.formatMessage({ id: 'moderation.aria.signIn', defaultMessage: 'Moderation sign-in' })}
      >
        <h2>
          <FormattedMessage id="moderation.signIn.heading" defaultMessage="Moderator sign-in" />
        </h2>
        <p className="hint">
          <FormattedMessage
            id="moderation.signIn.hint"
            defaultMessage="Reports stay hidden from the public map until a moderator approves them. Sign in with your moderator account to review the queue."
          />
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label htmlFor="modUser">
            <FormattedMessage id="moderation.username" defaultMessage="Username" />
          </label>
          <input
            id="modUser"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <label htmlFor="modPass">
            <FormattedMessage id="moderation.password" defaultMessage="Password" />
          </label>
          <input
            id="modPass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !username || !password}
          >
            {busy ? (
              <FormattedMessage id="moderation.signingIn" defaultMessage="Signing in…" />
            ) : (
              <FormattedMessage id="moderation.signIn" defaultMessage="Sign in" />
            )}
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      className="moderation"
      aria-label={intl.formatMessage({ id: 'moderation.aria.queue', defaultMessage: 'Moderation queue' })}
    >
      <div className="moderation-head">
        <h2>
          <FormattedMessage
            id="moderation.pending"
            defaultMessage="Pending review ({count})"
            values={{ count: queue.length }}
          />
        </h2>
        <span className="hint">
          <FormattedMessage
            id="moderation.signedInAs"
            defaultMessage="Signed in as {username}"
            values={{ username: session.username }}
          />
        </span>
        <button type="button" className="btn btn-small" onClick={() => load(session.token)}>
          <FormattedMessage id="common.refresh" defaultMessage="Refresh" />
        </button>
        <button type="button" className="btn btn-small" onClick={() => signOut()}>
          <FormattedMessage id="moderation.signOut" defaultMessage="Sign out" />
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {queue.length === 0 ? (
        <p className="empty-state">
          <FormattedMessage
            id="moderation.empty"
            defaultMessage="Nothing waiting. The queue is clear. ✓"
          />
        </p>
      ) : (
        <ul className="moderation-list">
          {queue.map((h) => (
            <li key={h.id} className="moderation-item">
              <div className="moderation-item-head">
                <strong>{labels.category(h.category)}</strong>
                <span className={`severity-text severity-text-${h.severity}`}>
                  {labels.severity(h.severity)}
                </span>
                <span className="hint">
                  <FormattedMessage
                    id="moderation.filed"
                    defaultMessage="filed {when}"
                    values={{ when: timeAgo(h.createdAt) }}
                  />
                </span>
              </div>
              {h.description && <p>{h.description}</p>}
              {h.photoUrl && (
                <HazardPhoto
                  className="moderation-photo"
                  src={h.photoUrl}
                  alt={intl.formatMessage({
                    id: 'moderation.photoAlt',
                    defaultMessage: 'Submitted hazard awaiting review',
                  })}
                />
              )}
              <div className="moderation-actions">
                <button
                  type="button"
                  className="btn btn-small btn-approve"
                  disabled={busy}
                  onClick={() => decide(h.id, 'approve')}
                >
                  <FormattedMessage id="moderation.approve" defaultMessage="Approve" />
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-reject"
                  disabled={busy}
                  onClick={() => decide(h.id, 'reject')}
                >
                  <FormattedMessage id="moderation.reject" defaultMessage="Reject" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
