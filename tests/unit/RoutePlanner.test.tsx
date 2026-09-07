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
  // Mirrors the real contract since #173: the error carries a failure CODE,
  // not display prose. A mock that still took a message would let this suite
  // keep passing against an error shape the module no longer throws.
  class GeolocationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { getCurrentLocation: vi.fn(), GeolocationError };
});

import { RoutePlanner } from '../../src/components/RoutePlanner.tsx';
import { fetchRoute as fetchRouteImport } from '../../src/lib/api.ts';
import { getCurrentLocation as getLocImport, GeolocationError } from '../../src/lib/geolocation.ts';
import { PLACE_LANDMARKS } from '../../src/lib/landmarks.ts';

const fetchRoute = vi.mocked(fetchRouteImport);
const getCurrentLocation = vi.mocked(getLocImport);

function plan(over: Partial<RoutePlan> = {}): RoutePlan {
  return {
    source: 'osrm',
    from: PLACE_LANDMARKS[0].point,
    to: PLACE_LANDMARKS[1].point,
    route: {
      geometry: [PLACE_LANDMARKS[0].point, PLACE_LANDMARKS[1].point],
      distanceMeters: 1500,
      durationSeconds: 360,
      steps: [
        { instruction: 'Head out on A St', distanceMeters: 800, location: PLACE_LANDMARKS[0].point },
        { instruction: 'Turn left onto B St', distanceMeters: 700, location: PLACE_LANDMARKS[1].point },
      ],
    },
    nearby: [],
    alternativesConsidered: 2,
    // Default: a real search that found no clear candidate. Tests that care
    // about the "hazard-free route" claim override this explicitly (issue #163).
    hazardFreeCandidate: false,
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

  // One corridor hazard on the chosen route — the input every "hazard-free
  // route" assertion below is made from.
  const hazardOnRoute = {
    hazard: {
      id: 'h1',
      category: 'pothole' as const,
      severity: 'high' as const,
      description: null,
      location: PLACE_LANDMARKS[0].point,
      photoUrl: null,
      status: 'approved' as const,
      confirmations: 0,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 9e15,
    },
    distanceMeters: 12,
    penalty: 700,
  };

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
              location: PLACE_LANDMARKS[0].point,
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
    // `hazardFreeCandidate: false` — every candidate scored carried a hazard,
    // which is the only case in which a "nothing was clear" claim is supportable.
    expect(
      screen.getByText(/none of the 2 routes considered was clear of reported hazards/i),
    ).toBeInTheDocument();
  });

  it('does not say "the 1 route" when a single candidate was scored and carried a hazard', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({ alternativesConsidered: 1, nearby: [hazardOnRoute], hazardFreeCandidate: false }),
    );
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/hazards still on this route/i)).toBeInTheDocument());
    expect(
      screen.getByText(/the only route considered was not clear of reported hazards/i),
    ).toBeInTheDocument();
  });

  // Issue #163: the warning used to be gated on `plan.nearby.length > 0` alone —
  // a claim about the whole search, made from the chosen route only. These three
  // pin each branch to the evidence the server actually supplies.
  it('does NOT claim a hazard-free route was unavailable when one was ranked and rejected', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ nearby: [hazardOnRoute], hazardFreeCandidate: true }));
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/hazards still on this route/i)).toBeInTheDocument());

    expect(screen.queryByText(/no hazard-free route was found/i)).toBeNull();
    expect(screen.queryByText(/none of the .* was clear of reported hazards/i)).toBeNull();
    expect(
      screen.getByText(/a route clear of reported hazards was considered, but it was longer/i),
    ).toBeInTheDocument();
  });

  it('does NOT claim anything about a search that never happened (straight-line fallback)', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        source: 'fallback',
        alternativesConsidered: 1,
        nearby: [hazardOnRoute],
        hazardFreeCandidate: null,
      }),
    );
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/hazards still on this route/i)).toBeInTheDocument());

    expect(screen.queryByText(/no hazard-free route was found/i)).toBeNull();
    expect(screen.queryByText(/was clear of reported hazards/i)).toBeNull();
    expect(
      screen.getByText(/not a route search, so no hazard-free alternative was looked for/i),
    ).toBeInTheDocument();
  });

  it('does not contradict the trade-off panel it renders beside', async () => {
    // The panel printed "the fastest option, which would pass near 0 reported
    // hazards" and "No hazard-free route was found" in the same render.
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        nearby: [hazardOnRoute],
        hazardFreeCandidate: true,
        fastestAlternative: { distanceMeters: 1400, durationSeconds: 330, nearby: [] },
      }),
    );
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(screen.getByText(/hazards still on this route/i)).toBeInTheDocument());

    expect(screen.getByText(/would pass near 0 reported hazards/i)).toBeInTheDocument();
    expect(screen.queryByText(/no hazard-free route was found/i)).toBeNull();
  });

  it('shows the fastest-alternative trade-off when the chosen route gave something up (EXP-03)', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        route: {
          geometry: [PLACE_LANDMARKS[0].point, PLACE_LANDMARKS[1].point],
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
                location: PLACE_LANDMARKS[0].point,
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
    const coop = PLACE_LANDMARKS.find((l) => /co-op/i.test(l.name))!;
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
    getCurrentLocation.mockRejectedValue(new GeolocationError('denied'));
    render(<RoutePlanner />);
    await userEvent.click(screen.getAllByRole('button', { name: /use my location/i })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't use your location/i);
  });
});
