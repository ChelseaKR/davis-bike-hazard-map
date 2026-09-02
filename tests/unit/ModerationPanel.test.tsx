import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { ModerationPanel } from '../../src/components/ModerationPanel.tsx';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

const SESSION_KEY = 'dbhm.session';

const queueItem: Hazard = {
  id: 'h1',
  category: 'pothole',
  severity: 'high',
  description: 'Pending pothole',
  location: { lat: 38.545, lng: -121.74 },
  photoUrl: null,
  status: 'pending',
  confirmations: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  expiresAt: Date.now() + 1_000_000,
};

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function storedSession(token = 'sess-token') {
  return JSON.stringify({ token, username: 'mod', expiresAt: Date.now() + 1_000_000 });
}

/** An already-approved hazard: live on the public map, not in the queue. */
const liveItem: Hazard = {
  ...queueItem,
  id: 'live1',
  category: 'glass_debris',
  severity: 'moderate',
  description: 'Glass in the bike lane',
  status: 'approved',
};

/** Queue pages served by the fetch mock, keyed by cursor ('' = first page). */
let queuePages: Record<
  string,
  { hazards: Hazard[]; nextCursor: string | null; total: number }
>;
/** The public feed the panel reads to show what is live on the map (#140). */
let publicFeed: { hazards: Hazard[] } | 'fail';

beforeEach(() => {
  localStorage.clear();
  queuePages = { '': { hazards: [queueItem], nextCursor: null, total: 1 } };
  publicFeed = { hazards: [liveItem] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/auth/login')) {
      const { username, password } = JSON.parse(String(init?.body ?? '{}'));
      return username === 'mod' && password === 'pw'
        ? resp({ token: 'sess-token', username: 'mod', expiresAt: Date.now() + 1_000_000 })
        : resp({ error: 'invalid_credentials', message: 'Wrong username or password.' }, 401);
    }
    if (url.includes('/moderation/handoff-failures')) {
      // The dead-letter surface (R3) is exercised in HandoffFailures.test.tsx;
      // an empty list here keeps it out of these queue-focused tests.
      return resp({ failures: [] });
    }
    if (url.includes('/moderation/queue')) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.authorization !== 'Bearer sess-token') {
        return resp({ error: 'unauthorized', message: 'no' }, 401);
      }
      const cursor = new URLSearchParams(url.split('?')[1] ?? '').get('cursor') ?? '';
      return resp(queuePages[cursor] ?? { hazards: [], nextCursor: null, total: 0 });
    }
    if (url.includes('/api/photos/')) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return headers.authorization === 'Bearer sess-token'
        ? ({
            ok: true,
            status: 200,
            blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
          } as Response)
        : resp({ error: 'not_found', message: 'Photo not available.' }, 404);
    }
    if (/\/moderation\/[^/]+$/.test(url) && init?.method === 'POST') {
      return resp({ hazard: { ...queueItem, status: 'approved' } });
    }
    if (/\/hazards(\?|$)/.test(url)) {
      return publicFeed === 'fail'
        ? resp({ error: 'internal_error', message: 'nope' }, 500)
        : resp(publicFeed);
    }
    return resp({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no object-URL support; the panel uses it for auth-fetched
  // photos. Subclassing keeps the real URL behaviour and unstubAllGlobals
  // restores the original class untouched.
  class MockURL extends URL {
    static override createObjectURL = vi.fn(() => 'blob:mock-photo');
    static override revokeObjectURL = vi.fn();
  }
  vi.stubGlobal('URL', MockURL);
});

afterEach(() => vi.unstubAllGlobals());

describe('ModerationPanel', () => {
  it('sign-in screen has no a11y violations', async () => {
    const { container } = render(<ModerationPanel />);
    await checkA11y(container);
  });

  it('rejects wrong credentials at sign-in', async () => {
    const user = userEvent.setup();
    render(<ModerationPanel />);
    await user.type(screen.getByLabelText(/username/i), 'mod');
    await user.type(screen.getByLabelText(/password/i), 'nope');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong username or password/i);
  });

  it('signs in, opens the queue, and approves an item', async () => {
    const user = userEvent.setup();
    render(<ModerationPanel />);
    await user.type(screen.getByLabelText(/username/i), 'mod');
    await user.type(screen.getByLabelText(/password/i), 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Pending pothole')).toBeInTheDocument();
    expect(screen.getByText(/pending review \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/signed in as mod/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/queue is clear/i)).toBeInTheDocument());
  });

  it('auto-opens the queue from a stored session and can sign out', async () => {
    localStorage.setItem(SESSION_KEY, storedSession());
    const user = userEvent.setup();
    render(<ModerationPanel />);

    expect(await screen.findByText('Pending pothole')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    // Back to the sign-in form.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('pages the queue with "Load more" and shows the full backlog count (FIX-04)', async () => {
    queuePages = {
      '': { hazards: [queueItem], nextCursor: 'cur-2', total: 2 },
      'cur-2': {
        hazards: [{ ...queueItem, id: 'h2', description: 'Second pending item' }],
        nextCursor: null,
        total: 2,
      },
    };
    localStorage.setItem(SESSION_KEY, storedSession());
    const user = userEvent.setup();
    render(<ModerationPanel />);

    // Headline shows the TOTAL backlog (2), not just the first page (1 item).
    expect(await screen.findByText(/pending review \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('Pending pothole')).toBeInTheDocument();
    expect(screen.queryByText('Second pending item')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /load more/i }));
    // The next page appends; the button disappears on the last page.
    expect(await screen.findByText('Second pending item')).toBeInTheDocument();
    expect(screen.getByText('Pending pothole')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('fetches a pending photo with the session token and renders it as a blob URL', async () => {
    queuePages = {
      '': {
        hazards: [{ ...queueItem, photoUrl: '/api/photos/h1' }],
        nextCursor: null,
        total: 1,
      },
    };
    localStorage.setItem(SESSION_KEY, storedSession());
    render(<ModerationPanel />);

    const img = await screen.findByRole('img', { name: /awaiting review/i });
    expect(img).toHaveAttribute('src', 'blob:mock-photo');
    // The photo bytes were requested with the moderator's bearer token.
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const photoCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/photos/h1'));
    expect(photoCall?.[1]?.headers).toMatchObject({ authorization: 'Bearer sess-token' });
  });
});

/**
 * The moderator "resolve" decision had no entry point (#140).
 *
 * The server has implemented it since M4: `moderationDecisionSchema` accepts
 * it, `MODERATION_TRANSITIONS.resolve` applies it, and `pending → resolved` and
 * `approved → resolved` are both legal in `shared/statusMachine.ts`. The client
 * typed `decideModeration`'s parameter as `'approve' | 'reject' | 'resolve'`
 * and then never once passed `'resolve'` — so the only way any hazard could
 * reach `resolved` was the 311 sync-back, which needs a configured provider
 * the quickstart does not have. With defaults, a hazard on the public map
 * could never be marked fixed from the running app.
 *
 * These are the reachability guard: they fail if the control disappears again.
 */
describe('ModerationPanel — resolve (#140)', () => {
  const resolveCalls = () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.filter(
      ([u, init]) =>
        /\/moderation\/[^/]+$/.test(String(u)) &&
        JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')).decision === 'resolve',
    );
  };

  it('lists hazards already live on the map, separately from the pending queue', async () => {
    localStorage.setItem(SESSION_KEY, storedSession());
    render(<ModerationPanel />);

    expect(await screen.findByText('Glass in the bike lane')).toBeInTheDocument();
    expect(screen.getByText(/live on the map \(1\)/i)).toBeInTheDocument();
    // The pending queue is still its own list with its own count.
    expect(screen.getByText('Pending pothole')).toBeInTheDocument();
    expect(screen.getByText(/pending review \(1\)/i)).toBeInTheDocument();
  });

  it('marks a live hazard resolved, and sends decision=resolve', async () => {
    localStorage.setItem(SESSION_KEY, storedSession());
    const user = userEvent.setup();
    render(<ModerationPanel />);

    await screen.findByText('Glass in the bike lane');
    await user.click(screen.getByRole('button', { name: /mark resolved/i }));

    await waitFor(() =>
      expect(screen.queryByText('Glass in the bike lane')).not.toBeInTheDocument(),
    );
    const calls = resolveCalls();
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain('/moderation/live1');
    expect((calls[0][1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer sess-token',
    });
    // Resolving something already live must not touch the pending backlog count.
    expect(screen.getByText(/pending review \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/live on the map \(0\)/i)).toBeInTheDocument();
  });

  it('offers "Already fixed" on a PENDING report too (pending → resolved is legal)', async () => {
    localStorage.setItem(SESSION_KEY, storedSession());
    const user = userEvent.setup();
    render(<ModerationPanel />);

    await screen.findByText('Pending pothole');
    await user.click(screen.getByRole('button', { name: /already fixed/i }));

    await waitFor(() => expect(screen.getByText(/queue is clear/i)).toBeInTheDocument());
    const calls = resolveCalls();
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain('/moderation/h1');
    expect(screen.getByText(/pending review \(0\)/i)).toBeInTheDocument();
  });

  /**
   * A failed read is not "0 hazards". This repo's most common defect is a
   * number that was never measured being rendered as if it had been.
   */
  it('says the live count is unknown when the feed fails — never zero', async () => {
    publicFeed = 'fail';
    localStorage.setItem(SESSION_KEY, storedSession());
    render(<ModerationPanel />);

    expect(await screen.findByText(/live on the map \(unknown\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/live on the map \(0\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing is live on the map/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/could not load what is live on the map/i),
    ).toBeInTheDocument();
  });

  it('says zero only when it actually read zero', async () => {
    publicFeed = { hazards: [] };
    localStorage.setItem(SESSION_KEY, storedSession());
    render(<ModerationPanel />);

    expect(await screen.findByText(/live on the map \(0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is live on the map/i)).toBeInTheDocument();
  });

  it('shows only approved hazards as live, whatever else the feed carries', async () => {
    publicFeed = { hazards: [liveItem, { ...queueItem, id: 'p2', description: 'Still pending' }] };
    localStorage.setItem(SESSION_KEY, storedSession());
    render(<ModerationPanel />);

    expect(await screen.findByText(/live on the map \(1\)/i)).toBeInTheDocument();
    expect(screen.queryByText('Still pending')).not.toBeInTheDocument();
  });

  it('has no a11y violations with both lists on screen', async () => {
    localStorage.setItem(SESSION_KEY, storedSession());
    const { container } = render(<ModerationPanel />);
    await screen.findByText('Glass in the bike lane');
    await checkA11y(container);
  });
});
