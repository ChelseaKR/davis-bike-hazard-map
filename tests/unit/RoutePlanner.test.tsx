import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import type { RoutePlan } from '../../shared/routing.ts';
import { ROUTE_PROFILE_IDS } from '../../shared/types.ts';

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
    profile: 'default',
    profileApplied: true,
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

/**
 * The paragraph whose whole text matches, including text inside <strong>.
 * `getByText` alone matches an element's own text nodes, so a sentence with a
 * bolded preference name in the middle would never match it.
 */
function paragraph(re: RegExp): HTMLElement | null {
  return screen.queryByText((_, el) => el?.tagName === 'P' && re.test(el.textContent ?? ''));
}

async function planIt() {
  await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
  await waitFor(() => expect(screen.getByText(/turn-by-turn directions/i)).toBeInTheDocument());
}

describe('RoutePlanner rider preference (issue #178)', () => {
  it('offers every profile as a radio in one labelled group, Standard selected', () => {
    fetchRoute.mockReset();
    render(<RoutePlanner />);
    const group = screen.getByRole('group', { name: 'Route preference' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([...ROUTE_PROFILE_IDS]);
    expect(within(group).getByRole('radio', { name: 'Standard' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Family / cargo bike' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'E-bike' })).not.toBeChecked();
  });

  it('never calls a preference safe; the one use of the word says none is', () => {
    fetchRoute.mockReset();
    render(<RoutePlanner />);
    const text = screen.getByRole('group', { name: 'Route preference' }).textContent ?? '';
    expect(text).not.toMatch(/safest/i);
    expect(text.match(/\bsafe\b/gi)).toHaveLength(1);
    expect(text).toMatch(/none of them makes a route safe/i);
  });

  it('describes each preference, to assistive technology, by the weights it applies', () => {
    fetchRoute.mockReset();
    render(<RoutePlanner />);
    const description = (name: string) => {
      const id = screen.getByRole('radio', { name }).getAttribute('aria-describedby');
      return document.getElementById(id ?? '')?.textContent ?? '';
    };
    expect(description('Standard')).toMatch(/counts as 800 m of extra riding, and less/);
    expect(description('Standard')).toMatch(/every hazard type counts the same/i);
    expect(description('Family / cargo bike')).toMatch(
      /counts as 2\.4 km of extra riding \(Standard: 800 m\)/,
    );
    expect(description('Family / cargo bike')).toMatch(/Dangerous intersection counts 2\.5× as much/);
    expect(description('Family / cargo bike')).toMatch(/never picks a route past a high-severity report/i);
    expect(description('E-bike')).toMatch(/counts as 1\.2 km of extra riding \(Standard: 800 m\)/);
    expect(description('E-bike')).toMatch(/Pothole and Surface damage count 1\.5× as much/);
    expect(description('E-bike')).toMatch(/Glass \/ debris counts 1\.3× as much/);
    expect(description('E-bike')).not.toMatch(/never picks/i);
  });

  it('sends the chosen preference with the plan', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ profile: 'family-safest' }));
    render(<RoutePlanner />);
    await userEvent.click(screen.getByRole('radio', { name: 'Family / cargo bike' }));
    await planIt();
    expect(fetchRoute).toHaveBeenCalledOnce();
    expect(fetchRoute.mock.calls[0][2]).toBe('family-safest');
  });

  it('says the preference chose the route only when more than one route was weighed', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({ profile: 'family-safest', profileApplied: true, alternativesConsidered: 3 }),
    );
    render(<RoutePlanner profile="family-safest" />);
    await planIt();
    expect(paragraph(/^Chosen with the Family \/ cargo bike preference\.$/)).toBeInTheDocument();
    const weights = screen.getByRole('list', { name: /how family \/ cargo bike weighs reported hazards/i });
    expect(within(weights).getAllByRole('listitem')).toHaveLength(4);
    expect(paragraph(/^For the route the Family \/ cargo bike preference chose\.$/)).toBeInTheDocument();
    expect(paragraph(/nothing to choose between/)).toBeNull();
    expect(paragraph(/did not choose this/)).toBeNull();
  });

  it('says the preference had nothing to choose between when the road network offered one route', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({ profile: 'e-bike', profileApplied: false, alternativesConsidered: 1 }),
    );
    render(<RoutePlanner profile="e-bike" />);
    await planIt();
    expect(
      paragraph(/^Planned with the E-bike preference, but the road network offered only this one route/),
    ).toBeInTheDocument();
    expect(paragraph(/^Chosen with/)).toBeNull();
    expect(paragraph(/^For the only route the road network offered/)).toBeInTheDocument();
    // The weights still priced the hazards on the one route, so they are shown.
    expect(screen.getByRole('list', { name: /how e-bike weighs reported hazards/i })).toBeInTheDocument();
  });

  it('says no preference chose a direct line', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({
        source: 'fallback',
        profile: 'e-bike',
        profileApplied: null,
        hazardFreeCandidate: null,
        alternativesConsidered: 1,
      }),
    );
    render(<RoutePlanner profile="e-bike" />);
    await planIt();
    expect(
      paragraph(/^The E-bike preference did not choose this: it is a direct line, not a route search\.$/),
    ).toBeInTheDocument();
    expect(paragraph(/^Chosen with/)).toBeNull();
    expect(paragraph(/^For a direct line; no route preference chose it\.$/)).toBeInTheDocument();
  });

  it('names no preference for a plan that records none, such as one cached before profiles existed', async () => {
    fetchRoute.mockReset();
    const legacy: Partial<RoutePlan> = plan();
    delete legacy.profile;
    delete legacy.profileApplied;
    fetchRoute.mockResolvedValue(legacy as RoutePlan);
    render(<RoutePlanner />);
    await planIt();
    expect(paragraph(/does not record what its route preference did/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /weighs reported hazards/i })).toBeNull();
    expect(paragraph(/^Chosen with/)).toBeNull();
    expect(paragraph(/^For the route the/)).toBeNull();
    expect(paragraph(/was planned with the/)).toBeNull();

    // Choosing a preference now must not produce "planned with the Standard
    // preference": the plan never said so, and a stale notice would invent it.
    // Without this step the test cannot see a plannedProfileOf that fills in a
    // default, because the outcome's own fallback branch absorbs it.
    await userEvent.click(screen.getByRole('radio', { name: 'E-bike' }));
    expect(paragraph(/was planned with the/)).toBeNull();
  });

  it('names no preference for a plan whose preference this build does not know', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(
      plan({ profile: 'cargo-trike' as RoutePlan['profile'], profileApplied: true }),
    );
    render(<RoutePlanner />);
    await planIt();
    expect(paragraph(/does not record what its route preference did/)).toBeInTheDocument();
    expect(paragraph(/^Chosen with/)).toBeNull();
  });

  it('does not read "not applied" into a real search that failed to say what its preference did', async () => {
    // `profileApplied: null` is only ever the fallback. On a real search it is
    // a server this build does not understand, and the panel must not guess.
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ source: 'osrm', profile: 'e-bike', profileApplied: null }));
    render(<RoutePlanner profile="e-bike" />);
    await planIt();
    expect(paragraph(/does not record what its route preference did/)).toBeInTheDocument();
    expect(paragraph(/direct line/)).toBeNull();
  });

  it('says a plan is stale when the preference changes after planning, and still describes the plan it shows', async () => {
    fetchRoute.mockReset();
    fetchRoute.mockResolvedValue(plan({ profile: 'default', profileApplied: true }));
    render(<RoutePlanner />);
    await planIt();
    expect(paragraph(/was planned with the/)).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'E-bike' }));
    expect(
      paragraph(
        /^The route below was planned with the Standard preference\. You have chosen E-bike since: plan again to use it\.$/,
      ),
    ).toBeInTheDocument();
    expect(paragraph(/^Chosen with the Standard preference\.$/)).toBeInTheDocument();

    fetchRoute.mockResolvedValue(plan({ profile: 'e-bike', profileApplied: true }));
    await userEvent.click(screen.getByRole('button', { name: /plan a safer route/i }));
    await waitFor(() => expect(paragraph(/^Chosen with the E-bike preference\.$/)).toBeInTheDocument());
    expect(paragraph(/was planned with the/)).toBeNull();
  });

  it('is controlled by App when App passes the preference', async () => {
    fetchRoute.mockReset();
    const onProfileChange = vi.fn();
    render(<RoutePlanner profile="e-bike" onProfileChange={onProfileChange} />);
    expect(screen.getByRole('radio', { name: 'E-bike' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Family / cargo bike' }));
    expect(onProfileChange).toHaveBeenCalledWith('family-safest');
    // Controlled: the permalink decides what is selected, not the click.
    expect(screen.getByRole('radio', { name: 'E-bike' })).toBeChecked();
  });
});
