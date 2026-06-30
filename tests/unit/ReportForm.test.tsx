import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportForm } from '../../src/components/ReportForm.tsx';
import { getAllReports, _resetDbForTests } from '../../src/lib/db.ts';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

function nearbyPothole(): Hazard {
  return {
    id: 'dup-1',
    clientId: 'dup-1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 1,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
  };
}

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

    // Success is announced via a live region (SR walkthrough §2).
    expect(await screen.findByRole('status')).toHaveTextContent(/report saved/i);
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

  it('nudges to confirm a nearby duplicate instead of filing a new report', async () => {
    mockGeolocation({ latitude: 38.5449, longitude: -121.7405 });
    const onConfirmExisting = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportForm nearbyHazards={[nearbyPothole()]} onConfirmExisting={onConfirmExisting} />,
    );

    // Default category is "pothole"; setting the matching location reveals the nudge.
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    const nudge = await screen.findByRole('region', { name: /possible duplicates nearby/i });
    expect(nudge).toBeInTheDocument();
    await checkA11y(document.body); // the nudge itself must be accessible

    await userEvent.click(screen.getByRole('button', { name: /confirm it instead/i }));
    expect(onConfirmExisting).toHaveBeenCalledWith('dup-1');
    // The nudge resolves into a thank-you and stops offering the duplicate.
    expect(await screen.findByText(/we counted your/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /confirm it instead/i }),
    ).not.toBeInTheDocument();
  });

  it('does not nudge when the chosen category has no nearby match', async () => {
    mockGeolocation({ latitude: 38.5449, longitude: -121.7405 });
    render(<ReportForm nearbyHazards={[nearbyPothole()]} onConfirmExisting={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'glass_debris');
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await waitFor(() =>
      expect(screen.getByText(/no location set yet|location:/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('region', { name: /possible duplicates nearby/i }),
    ).not.toBeInTheDocument();
  });
});
