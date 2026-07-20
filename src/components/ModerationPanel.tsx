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
  fetchModerationPhoto,
  fetchModerationQueue,
  login,
  ApiRequestError,
  type Session,
} from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';
import { HazardPhoto } from './HazardPhoto.tsx';

/**
 * A pending hazard's photo. Pending photo bytes are auth-gated on the server
 * (FIX-04), so the bytes are fetched with the moderator's bearer token and
 * rendered from a local blob URL (revoked on unmount).
 */
function ModerationPhoto({ photoUrl, token, alt }: { photoUrl: string; token: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const intl = useIntl();

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    fetchModerationPhoto(photoUrl, token)
      .then((url) => {
        objectUrl = url;
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUrl, token]);

  if (failed) {
    // Same accessible fallback HazardPhoto renders when an <img> fails to load.
    return (
      <p
        className="photo-unavailable moderation-photo"
        role="img"
        aria-label={intl.formatMessage(
          { id: 'photo.unavailableAria', defaultMessage: '{alt} — photo unavailable' },
          { alt },
        )}
      >
        <FormattedMessage id="photo.unavailable" defaultMessage="Photo unavailable" />
      </p>
    );
  }
  if (!src) return null;
  return <HazardPhoto className="moderation-photo" src={src} alt={alt} />;
}

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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback((message?: string) => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setQueue([]);
    setNextCursor(null);
    setTotal(0);
    setPassword('');
    if (message) setError(message);
  }, []);

  // Fetch one queue page (FIX-04). Without a cursor the queue is reloaded from
  // the top; with one, the next page is appended to what's already shown.
  const load = useCallback(
    async (tok: string, cursor?: string) => {
      setBusy(true);
      setError(null);
      try {
        const page = await fetchModerationQueue(tok, cursor);
        setQueue((q) => (cursor ? [...q, ...page.hazards] : page.hazards));
        setNextCursor(page.nextCursor);
        setTotal(page.total);
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
    // Load once on mount with a stored session. Deliberately excludes `load`
    // from deps: re-running on every render-scoped `load` identity change
    // would refetch the queue in a loop. No tracking issue filed yet — CQ-35
    // wants every suppression linked to one; file one and replace this note
    // if this effect needs revisiting (flagged in
    // audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md, quick win 9).
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
      setTotal((t) => Math.max(0, t - 1));
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
            values={{ count: total }}
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
                <ModerationPhoto
                  photoUrl={h.photoUrl}
                  token={session.token}
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
      {nextCursor && (
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => load(session.token, nextCursor)}
        >
          <FormattedMessage
            id="moderation.loadMore"
            defaultMessage="Load more ({shown} of {total} shown)"
            values={{ shown: queue.length, total }}
          />
        </button>
      )}
    </section>
  );
}
