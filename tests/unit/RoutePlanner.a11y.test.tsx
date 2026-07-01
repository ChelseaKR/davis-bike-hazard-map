import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { checkA11y } from '../axe.ts';
import type { RoutePlan } from '../../shared/routing.ts';

vi.mock('../../src/components/RouteMap.tsx', () => ({ RouteMap: () => <div /> }));
vi.mock('../../src/lib/api.ts', () => ({ fetchRoute: vi.fn() }));

import { RoutePlanner } from '../../src/components/RoutePlanner.tsx';
import { fetchRoute as fetchRouteImport } from '../../src/lib/api.ts';
import { DAVIS_LANDMARKS } from '../../src/lib/landmarks.ts';

const fetchRoute = vi.mocked(fetchRouteImport);

const plan: RoutePlan = {
  source: 'osrm',
  from: DAVIS_LANDMARKS[0].point,
  to: DAVIS_LANDMARKS[1].point,
  route: {
    geometry: [DAVIS_LANDMARKS[0].point, DAVIS_LANDMARKS[1].point],
    distanceMeters: 1500,
    durationSeconds: 360,
    steps: [{ instruction: 'Head out on A St', distanceMeters: 1500, location: DAVIS_LANDMARKS[0].point }],
  },
  nearby: [],
  alternativesConsidered: 1,
};

describe('RoutePlanner accessibility', () => {
  it('has no violations for the empty planner form', async () => {
    fetchRoute.mockReset();
    const { container } = render(<RoutePlanner />);
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
});
