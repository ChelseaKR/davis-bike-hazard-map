import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { checkA11y } from '../axe.ts';
import type { RoutePlan } from '../../shared/routing.ts';

vi.mock('../../src/components/RouteMap.tsx', () => ({ RouteMap: () => <div /> }));
vi.mock('../../src/lib/api.ts', () => ({ fetchRoute: vi.fn() }));

import { RoutePlanner } from '../../src/components/RoutePlanner.tsx';
import { fetchRoute as fetchRouteImport } from '../../src/lib/api.ts';
import { PLACE_LANDMARKS } from '../../src/lib/landmarks.ts';

const fetchRoute = vi.mocked(fetchRouteImport);

const plan: RoutePlan = {
  source: 'osrm',
  from: PLACE_LANDMARKS[0].point,
  to: PLACE_LANDMARKS[1].point,
  route: {
    geometry: [PLACE_LANDMARKS[0].point, PLACE_LANDMARKS[1].point],
    distanceMeters: 1500,
    durationSeconds: 360,
    steps: [{ instruction: 'Head out on A St', distanceMeters: 1500, location: PLACE_LANDMARKS[0].point }],
  },
  nearby: [
    {
      hazard: {
        id: 'h1',
        category: 'pothole',
        severity: 'high',
        description: null,
        location: PLACE_LANDMARKS[0].point,
        photoUrl: null,
        status: 'approved',
        confirmations: 0,
        createdAt: 1,
        updatedAt: 1,
        expiresAt: 9e15,
      },
      distanceMeters: 8,
      penalty: 650,
    },
  ],
  alternativesConsidered: 2,
  hazardFreeCandidate: false,
  profile: 'default',
  profileApplied: true,
  fastestAlternative: {
    distanceMeters: 1300,
    durationSeconds: 320,
    nearby: [],
  },
};

describe('RoutePlanner accessibility', () => {
  it('has no violations for the empty planner form', async () => {
    fetchRoute.mockReset();
    const { container } = render(<RoutePlanner />);
    // Content first: the picker is part of this form now, and a scan that
    // passed without it on screen would say nothing about it.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    await checkA11y(container);
  });

  it('has no violations after a route (turn-by-turn) is rendered', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan);
    const { container } = render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/turn-by-turn directions/i)).toBeInTheDocument());
    await checkA11y(container);
  });

  it('has no violations with an unapplied preference and a stale-plan notice on screen', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue({
      ...plan,
      source: 'fallback',
      profile: 'e-bike',
      profileApplied: null,
      hazardFreeCandidate: null,
    });
    const { container } = render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('radio', { name: 'E-bike' }));
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/turn-by-turn directions/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    // Content first, again: both surfaces this scan exists for must be present.
    expect(container.querySelector('.route-profile-stale')?.textContent).toMatch(
      /planned with the E-bike preference/,
    );
    expect(container.querySelector('.route-profile-result')?.textContent).toMatch(
      /did not choose this/,
    );
    await checkA11y(container);
  });
});
