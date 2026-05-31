import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModerationPanel } from '../../src/components/ModerationPanel.tsx';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

const TOKEN_KEY = 'dbhm.moderatorToken';

const queueItem: Hazard = {
  id: 'h1',
  clientId: 'c1',
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

beforeEach(() => {
  localStorage.clear();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.includes('/moderation/queue')) {
      return headers.authorization === 'Bearer secret'
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

  it('rejects an invalid token entered in the form', async () => {
    const user = userEvent.setup();
    render(<ModerationPanel />);
    await user.type(screen.getByLabelText(/moderator token/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /open queue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not accepted/i);
  });

  it('auto-opens the queue from a stored token and approves an item', async () => {
    localStorage.setItem(TOKEN_KEY, 'secret');
    const user = userEvent.setup();
    render(<ModerationPanel />);

    expect(await screen.findByText('Pending pothole')).toBeInTheDocument();
    expect(screen.getByText(/pending review \(1\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/queue is clear/i)).toBeInTheDocument());
  });
});
