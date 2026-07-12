import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { MyReports } from '../../src/components/MyReports.tsx';
import { enqueueReport, updateReport, _resetDbForTests } from '../../src/lib/db.ts';
import { checkA11y } from '../axe.ts';
import type { Hazard, ReportSubmission } from '../../shared/types.ts';

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

/** Stub fetch so a synced report's status request resolves to `hazard`. */
function stubStatus(hazard: Partial<Hazard>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hazard }),
    }),
  );
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

  it('shows the feedback trail for a report that reached the server', async () => {
    await enqueueReport(submission('a'));
    await updateReport('a', { state: 'synced', serverId: 's1' });
    stubStatus({ status: 'approved', confirmations: 0, handoff: null });
    render(<MyReports />);

    const trail = await screen.findByRole('list', { name: /report progress/i });
    expect(trail).toBeInTheDocument();
    // The approved report is live on the map; the review step is behind it.
    expect(screen.getByText('On the map')).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    await checkA11y(document.body); // the trail must be accessible
  });

  it('surfaces a rejected report in the trail', async () => {
    await enqueueReport(submission('a'));
    await updateReport('a', { state: 'synced', serverId: 's1' });
    stubStatus({ status: 'rejected', confirmations: 0, handoff: null });
    render(<MyReports />);
    expect(await screen.findByText('Not approved')).toBeInTheDocument();
  });
});
