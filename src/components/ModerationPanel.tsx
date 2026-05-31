/**
 * Lightweight moderation queue. Nothing reaches the public map until a
 * moderator approves it here (the "no unmoderated public photo feed" gate).
 *
 * Auth is a shared moderator token kept in localStorage on the moderator's
 * device — deliberately simple for a civic MVP; the server is the authority and
 * rejects every moderation call without a valid token.
 */
import { useCallback, useEffect, useState } from 'react';
import { CATEGORY_LABELS, SEVERITY_LABELS, type Hazard } from '../../shared/types.ts';
import { decideModeration, fetchModerationQueue } from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';

const TOKEN_KEY = 'dbhm.moderatorToken';

export function ModerationPanel() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) ?? '',
  );
  const [authed, setAuthed] = useState(false);
  const [queue, setQueue] = useState<Hazard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (tok: string) => {
    setBusy(true);
    setError(null);
    try {
      setQueue(await fetchModerationQueue(tok));
      setAuthed(true);
      localStorage.setItem(TOKEN_KEY, tok);
    } catch {
      setAuthed(false);
      setError('That moderator token was not accepted.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
    // Only auto-load once on mount with a stored token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (
    id: string,
    decision: 'approve' | 'reject' | 'resolve',
  ) => {
    setBusy(true);
    try {
      await decideModeration(id, decision, token);
      setQueue((q) => q.filter((h) => h.id !== id));
    } catch {
      setError('Could not record that decision. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <section className="moderation" aria-label="Moderation sign-in">
        <h2>Moderator access</h2>
        <p className="hint">
          Reports stay hidden from the public map until a moderator approves
          them. Enter your moderator token to review the queue.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(token);
          }}
        >
          <label htmlFor="modToken">Moderator token</label>
          <input
            id="modToken"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !token}>
            {busy ? 'Checking…' : 'Open queue'}
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
        <button type="button" className="btn btn-small" onClick={() => load(token)}>
          Refresh
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
                <img
                  className="moderation-photo"
                  src={h.photoUrl}
                  alt="Submitted hazard awaiting review"
                  loading="lazy"
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
