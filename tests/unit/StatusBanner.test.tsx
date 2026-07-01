import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import { StatusBanner } from '../../src/components/StatusBanner.tsx';
import { enqueueReport, updateReport, _resetDbForTests } from '../../src/lib/db.ts';
import type { ReportSubmission } from '../../shared/types.ts';

function submission(id: string): ReportSubmission {
  return {
    category: 'pothole',
    severity: 'high',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: id,
    capturedAt: Date.now(),
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

beforeEach(async () => {
  setOnline(true);
  await _resetDbForTests();
});

afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('StatusBanner', () => {
  it('renders nothing when online with an empty queue', () => {
    const { container } = render(<StatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces reports waiting to sync', async () => {
    await enqueueReport(submission('a'));
    render(<StatusBanner refreshKey={1} />);
    expect(await screen.findByText(/1 report waiting to sync/i)).toBeInTheDocument();
  });

  it('surfaces failed reports distinctly', async () => {
    await enqueueReport(submission('a'));
    await updateReport('a', { state: 'error', lastError: 'boom' });
    render(<StatusBanner refreshKey={2} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn't sync/i)).toBeInTheDocument(),
    );
  });

  it('shows an offline message when offline', async () => {
    setOnline(false);
    render(<StatusBanner />);
    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
  });
});
