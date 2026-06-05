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
import { CATEGORY_LABELS, SEVERITY_LABELS, type Hazard } from '../../shared/types.ts';
import {
  decideModeration,
  fetchModerationQueue,
  login,
  ApiRequestError,
  type Session,
} from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';
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
          signOut('Your session expired. Please sign in again.');
        } else {
          setError('Could not load the queue. Try again.');
        }
      } finally {
        setBusy(false);
      }
    },
    [signOut],
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
      setError('Wrong username or password.');
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
        signOut('Your session expired. Please sign in again.');
      } else {
        setError('Could not record that decision. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <section className="moderation" aria-label="Moderation sign-in">
        <h2>Moderator sign-in</h2>
        <p className="hint">
          Reports stay hidden from the public map until a moderator approves
          them. Sign in with your moderator account to review the queue.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label htmlFor="modUser">Username</label>
          <input
            id="modUser"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <label htmlFor="modPass">Password</label>
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
            {busy ? 'Signing in…' : 'Sign in'}
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
    <section className="moderation" aria-label="Moderation queue">
      <div className="moderation-head">
        <h2>Pending review ({queue.length})</h2>
        <span className="hint">Signed in as {session.username}</span>
        <button type="button" className="btn btn-small" onClick={() => load(session.token)}>
          Refresh
        </button>
        <button type="button" className="btn btn-small" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {queue.length === 0 ? (
        <p className="empty-state">Nothing waiting. The queue is clear. ✓</p>
      ) : (
        <ul className="moderation-list">
          {queue.map((h) => (
            <li key={h.id} className="moderation-item">
              <div className="moderation-item-head">
                <strong>{CATEGORY_LABELS[h.category]}</strong>
                <span className={`severity-text severity-text-${h.severity}`}>
                  {SEVERITY_LABELS[h.severity]}
                </span>
                <span className="hint">filed {timeAgo(h.createdAt)}</span>
              </div>
              {h.description && <p>{h.description}</p>}
              {h.photoUrl && (
                <HazardPhoto
                  className="moderation-photo"
                  src={h.photoUrl}
                  alt="Submitted hazard awaiting review"
                />
              )}
              <div className="moderation-actions">
                <button
                  type="button"
                  className="btn btn-small btn-approve"
                  disabled={busy}
                  onClick={() => decide(h.id, 'approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-reject"
                  disabled={busy}
                  onClick={() => decide(h.id, 'reject')}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
