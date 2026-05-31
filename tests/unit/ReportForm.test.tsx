import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportForm } from '../../src/components/ReportForm.tsx';
import { getAllReports, _resetDbForTests } from '../../src/lib/db.ts';
import { checkA11y } from '../axe.ts';

function mockGeolocation(point: { latitude: number; longitude: number }) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { ...point } } as GeolocationPosition),
    },
  });
}

beforeEach(async () => {
  await _resetDbForTests();
  // Keep the fire-and-forget sync quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ hazard: { id: 's1' } }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReportForm', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<ReportForm />);
    await checkA11y(container);
  });

  it('keeps submit disabled until a valid Davis location is set', () => {
    render(<ReportForm />);
    expect(screen.getByRole('button', { name: /submit report/i })).toBeDisabled();
  });

  it('saves a report to the offline queue on submit', async () => {
    mockGeolocation({ latitude: 38.5449, longitude: -121.7405 });
    render(<ReportForm />);

    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'glass_debris');
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));

    const submit = screen.getByRole('button', { name: /submit report/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    expect(await screen.findByText(/report saved/i)).toBeInTheDocument();
    const stored = await getAllReports();
    expect(stored).toHaveLength(1);
    expect(stored[0].submission.category).toBe('glass_debris');
  });

  it('falls back to the map when geolocation is denied', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_s: PositionCallback, error: PositionErrorCallback) =>
          error({
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'denied',
          } as unknown as GeolocationPositionError),
      },
    });
    render(<ReportForm />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i);
  });
});
