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

beforeEach(() => {
  localStorage.clear();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/auth/login')) {
      const { username, password } = JSON.parse(String(init?.body ?? '{}'));
      return username === 'mod' && password === 'pw'
        ? resp({ token: 'sess-token', username: 'mod', expiresAt: Date.now() + 1_000_000 })
        : resp({ error: 'invalid_credentials', message: 'Wrong username or password.' }, 401);
    }
    if (url.includes('/moderation/queue')) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return headers.authorization === 'Bearer sess-token'
        ? resp({ hazards: [queueItem] })
        : resp({ error: 'unauthorized', message: 'no' }, 401);
    }
    if (/\/moderation\/[^/]+$/.test(url) && init?.method === 'POST') {
      return resp({ hazard: { ...queueItem, status: 'approved' } });
    }
    return resp({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
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
});
