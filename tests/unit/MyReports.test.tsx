import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { MyReports } from '../../src/components/MyReports.tsx';
import { enqueueReport, _resetDbForTests } from '../../src/lib/db.ts';
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

beforeEach(async () => {
  await _resetDbForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ hazard: { id: 's1' } }) }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('MyReports', () => {
  it('shows the empty state when there are no reports', async () => {
    render(<MyReports />);
    expect(await screen.findByText(/haven't filed any hazards/i)).toBeInTheDocument();
  });

  it('lists a queued report with its state', async () => {
    await enqueueReport(submission('a'));
    render(<MyReports />);
    expect(await screen.findByText('Pothole')).toBeInTheDocument();
    expect(screen.getByText(/waiting to sync/i)).toBeInTheDocument();
  });

  it('deletes a report from the device', async () => {
    await enqueueReport(submission('a'));
    const onChange = vi.fn();
    render(<MyReports onChange={onChange} />);
    await screen.findByText('Pothole');
    await userEvent.click(screen.getByRole('button', { name: /delete from this device/i }));
    await waitFor(() => expect(screen.getByText(/haven't filed any hazards/i)).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('offers a manual "Sync now" when reports are pending and online', async () => {
    await enqueueReport(submission('a'));
    render(<MyReports />);
    await screen.findByText('Pothole');
    expect(screen.getByRole('button', { name: /sync now/i })).toBeEnabled();
  });
});
