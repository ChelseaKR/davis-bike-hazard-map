import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { HandoffFailures } from '../../src/components/HandoffFailures.tsx';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

const hazard: Hazard = {
  id: 'h1',
  category: 'pothole',
  severity: 'high',
  description: 'Deep pothole',
  location: { lat: 38.545, lng: -121.74 },
  photoUrl: null,
  status: 'approved',
  confirmations: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  expiresAt: Date.now() + 1_000_000,
};

const failure = {
  hazard,
  delivery: {
    state: 'failed',
    dryRun: false,
    attempts: 6,
    lastAttemptAt: Date.now() - 60_000,
    nextRetryAt: null,
    lastError: '311 responded 502',
  },
};

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Failure list the mock serves; a successful re-send empties it. */
let failures: unknown[];

beforeEach(() => {
  failures = [failure];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.authorization !== 'Bearer sess-token') {
      return resp({ error: 'unauthorized', message: 'no' }, 401);
    }
    if (url.includes('/moderation/handoff-failures')) {
      return resp({ failures });
    }
    if (/\/moderation\/[^/]+\/handoff$/.test(url) && init?.method === 'POST') {
      failures = []; // the re-send un-dead-letters it
      return resp({ result: { delivered: true, dryRun: false }, hazard });
    }
    return resp({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('HandoffFailures', () => {
  it('renders nothing when there are no dead letters (the healthy state)', async () => {
    failures = [];
    const { container } = render(<HandoffFailures token="sess-token" />);
    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
    );
    expect(container.querySelector('.handoff-failures')).toBeNull();
  });

  it('lists a dead-lettered hand-off with its receipt and no a11y violations', async () => {
    const { container } = render(<HandoffFailures token="sess-token" />);
    expect(await screen.findByText(/failed 311 hand-offs \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/6 attempts, last tried/i)).toBeInTheDocument();
    expect(screen.getByText('311 responded 502')).toBeInTheDocument();
    await checkA11y(container);
  });

  it('re-sends via the hand-off route and clears the list on success', async () => {
    const user = userEvent.setup();
    render(<HandoffFailures token="sess-token" />);
    await user.click(await screen.findByRole('button', { name: /re-send to 311/i }));

    await waitFor(() =>
      expect(screen.queryByText(/failed 311 hand-offs/i)).not.toBeInTheDocument(),
    );
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const resend = fetchMock.mock.calls.find(
      ([u, init]) => /\/moderation\/h1\/handoff$/.test(String(u)) && init?.method === 'POST',
    );
    expect(resend?.[1]?.headers).toMatchObject({ authorization: 'Bearer sess-token' });
  });
});
