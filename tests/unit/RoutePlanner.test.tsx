import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import type { RoutePlan } from '../../shared/routing.ts';

// The Leaflet map is a lazy enhancement that needs a real DOM — stub it so the
// jsdom test exercises the accessible (map-free) output.
vi.mock('../../src/components/RouteMap.tsx', () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));

vi.mock('../../src/lib/api.ts', () => ({ fetchRoute: vi.fn() }));

vi.mock('../../src/lib/geolocation.ts', () => {
  class GeolocationError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return { getCurrentLocation: vi.fn(), GeolocationError };
});

import { RoutePlanner } from '../../src/components/RoutePlanner.tsx';
import { fetchRoute as fetchRouteImport } from '../../src/lib/api.ts';
import { getCurrentLocation as getLocImport, GeolocationError } from '../../src/lib/geolocation.ts';
import { DAVIS_LANDMARKS } from '../../src/lib/landmarks.ts';

const fetchRoute = vi.mocked(fetchRouteImport);
const getCurrentLocation = vi.mocked(getLocImport);

function plan(over: Partial<RoutePlan> = {}): RoutePlan {
  return {
    source: 'osrm',
    from: DAVIS_LANDMARKS[0].point,
    to: DAVIS_LANDMARKS[1].point,
    route: {
      geometry: [DAVIS_LANDMARKS[0].point, DAVIS_LANDMARKS[1].point],
      distanceMeters: 1500,
      durationSeconds: 360,
      steps: [
        { instruction: 'Head out on A St', distanceMeters: 800, location: DAVIS_LANDMARKS[0].point },
        { instruction: 'Turn left onto B St', distanceMeters: 700, location: DAVIS_LANDMARKS[1].point },
      ],
    },
    nearby: [],
    alternativesConsidered: 2,
    fastestAlternative: null,
    ...over,
  };
}

describe('RoutePlanner', () => {
  // NOTE: mocks are reset at the top of each test body, NOT in a beforeEach —
  // resetting a module-mock fn from beforeEach makes Vitest spuriously flag a
  // later (correctly caught) promise rejection as unhandled.

  it('renders accessible start/end selectors', () => {
    fetchRoute.mockReset();
    render(<RoutePlanner />);
    expect(screen.getByLabelText('Start')).toBeInTheDocument();
    expect(screen.getByLabelText('Destination')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /plan a safer route/i })).toBeInTheDocument();
  });

  it('plans a route and lists turn-by-turn directions (map-free output)', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan());
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));

    await waitFor(() => expect(screen.getByText(/turn-by-turn directions/i)).toBeInTheDocument());
    expect(screen.getByText(/Head out on A St/)).toBeInTheDocument();
    expect(screen.getByText(/Turn left onto B St/)).toBeInTheDocument();
    // Summary stats.
    expect(screen.getByText('1.5 km')).toBeInTheDocument();
    expect(screen.getByText('6 min')).toBeInTheDocument();
    expect(fetchRoute).toHaveBeenCalledOnce();
  });

  it('lists hazards still on the route and warns when none could be avoided', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        nearby: [
          {
            hazard: {
              id: 'h1',
              category: 'pothole',
              severity: 'high',
              description: null,
              location: DAVIS_LANDMARKS[0].point,
              photoUrl: null,
              status: 'approved',
              confirmations: 0,
              createdAt: 1,
              updatedAt: 1,
              expiresAt: 9e15,
            },
            distanceMeters: 12,
            penalty: 700,
          },
        ],
      }),
    );
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/hazards still on this route/i)).toBeInTheDocument());
    expect(screen.getByText(/Pothole · High · 12 m from your route/)).toBeInTheDocument();
    // The per-hazard penalty breakdown (EXP-03): the scorer's contribution, surfaced.
    expect(screen.getByText(/adds 700 m to this route's score/)).toBeInTheDocument();
    expect(screen.getByText(/no hazard-free route was found/i)).toBeInTheDocument();
  });

  it('shows the fastest-alternative trade-off when the chosen route gave something up (EXP-03)', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        route: {
          geometry: [DAVIS_LANDMARKS[0].point, DAVIS_LANDMARKS[1].point],
          distanceMeters: 1700,
          durationSeconds: 400,
          steps: [],
        },
        fastestAlternative: {
          distanceMeters: 1500,
          durationSeconds: 340,
          nearby: [
            {
              hazard: {
                id: 'h1',
                category: 'pothole',
                severity: 'high',
                description: null,
                location: DAVIS_LANDMARKS[0].point,
                photoUrl: null,
                status: 'approved',
                confirmations: 0,
                createdAt: 1,
                updatedAt: 1,
                expiresAt: 9e15,
              },
              distanceMeters: 5,
              penalty: 700,
            },
          ],
        },
      }),
    );
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() =>
      expect(screen.getByText(/versus the fastest option/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/adds 200 m and 1 min/i)).toBeInTheDocument();
    expect(screen.getByText(/pass near 1 reported hazard\b/i)).toBeInTheDocument();
  });

  it('omits the trade-off comparison when the chosen route already is the fastest', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ fastestAlternative: null }));
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/your route/i)).toBeInTheDocument());
    expect(screen.queryByText(/versus the fastest option/i)).not.toBeInTheDocument();
  });

  it('explains the straight-line fallback when routing is unavailable', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ source: 'fallback' }));
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/direct line/i)).toBeInTheDocument());
  });

  it('surfaces an error if planning fails', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockRejectedValue(new Error('network down'));
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i);
  });

  it('updates an endpoint when a landmark is selected', async () => {
    fetchRoute.mockReset();
    render(<RoutePlanner />);
    const coop = DAVIS_LANDMARKS.find((l) => /co-op/i.test(l.name))!;
    await userEvent.selectOptions(screen.getByLabelText('Destination'), coop.name);
    const expected = `${coop.point.lat.toFixed(4)}, ${coop.point.lng.toFixed(4)}`;
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('sets an endpoint from the device location when granted', async () => {
    fetchRoute.mockReset();
    getCurrentLocation.mockReset();
    getCurrentLocation.mockResolvedValue({ lat: 38.55, lng: -121.74 });
    render(<RoutePlanner />);
    await userEvent.click(screen.getAllByRole('button', { name: /use my location/i })[0]);
    await waitFor(() => expect(screen.getByText('38.5500, -121.7400')).toBeInTheDocument());
  });

  it('shows an error when location permission is denied', async () => {
    fetchRoute.mockReset();
    getCurrentLocation.mockReset();
    getCurrentLocation.mockRejectedValue(new GeolocationError('permission denied', 'denied'));
    render(<RoutePlanner />);
    await userEvent.click(screen.getAllByRole('button', { name: /use my location/i })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't use your location/i);
  });
});
