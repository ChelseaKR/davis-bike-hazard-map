/**
 * CoverageView — which set the numbers and the data-desert call-out come from.
 *
 * The view exists to stop "no reports here" reading as "this area is safe"
 * (docs/audits/coverage-equity.md). It therefore must never call an area a data
 * desert on the strength of the public hazard feed, which omits every pending,
 * rejected, expired and older-resolved report. `GET /api/coverage` is the
 * authority; when it is unreachable the view says so and withholds the flags
 * rather than guessing them from the feed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import { CoverageView } from '../../src/components/CoverageView.tsx';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';
import { DAVIS_AREAS, ELSEWHERE_AREA } from '../../shared/areas.ts';

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** An approved hazard in Central Davis — the kind the public feed carries. */
const feedHazard: Hazard = {
  id: 'h1',
  category: 'pothole',
  severity: 'high',
  description: 'Pothole',
  location: { lat: 38.5449, lng: -121.7405 },
  photoUrl: null,
  status: 'approved',
  confirmations: 0,
  createdAt: 0,
  updatedAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

/** Every named area at zero except North Davis, which has been reported. */
function coverageWithNorthReported() {
  return {
    areas: DAVIS_AREAS.map((a) => ({ name: a.name, count: a.name === 'North Davis' ? 4 : 0 })),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => resp(coverageWithNorthReported()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CoverageView', () => {
  it('does not call an area a data desert when its reports exist but are not in the feed', async () => {
    // The feed carries one Central Davis hazard and nothing in North Davis:
    // North's four reports are pending, or expired, or resolved a while back.
    render(<CoverageView hazards={[feedHazard]} />);

    await waitFor(() => expect(screen.getByText(/Data deserts:/)).toBeInTheDocument());
    const callout = screen.getByText(/Data deserts:/).closest('p')!;
    expect(callout.textContent).not.toContain('North Davis');
    // The areas nobody has reported are still called out - that is the point.
    expect(callout.textContent).toContain('South Davis');
    expect(screen.getByText('4 reports')).toBeInTheDocument();
  });

  it('reads its counts from the coverage endpoint, not the hazard feed', async () => {
    render(<CoverageView hazards={[feedHazard]} />);
    await waitFor(() => expect(screen.getByText('4 reports')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/coverage');
    // The one Central Davis hazard in the feed must not have become a count.
    const central = screen.getByText('Central Davis').closest('li')!;
    expect(central.textContent).toContain('No reports yet');
  });

  it('withholds every data-desert flag when the totals cannot be loaded', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<CoverageView hazards={[feedHazard]} />);

    await waitFor(() => expect(screen.getByText(/Partial view:/)).toBeInTheDocument());
    // No area may be labelled a desert from the feed alone.
    expect(screen.queryByText(/Data deserts:/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No reports yet — a likely data desert/),
    ).not.toBeInTheDocument();
  });

  it('says "on the map", not "reported", when it is showing the feed', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<CoverageView hazards={[feedHazard]} />);

    await waitFor(() => expect(screen.getByText(/Partial view:/)).toBeInTheDocument());
    expect(screen.getByText('1 on the map')).toBeInTheDocument();
    expect(screen.getAllByText('None on the map right now')).toHaveLength(5);
    // "No reports yet" would be a claim about reports the feed cannot support.
    expect(screen.queryByText('No reports yet')).not.toBeInTheDocument();
  });

  it('prints no per-area number at all until the totals arrive', () => {
    // Never-settling fetch: the pre-load frame must not show feed counts.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<CoverageView hazards={[feedHazard]} />);

    expect(screen.getByText('Loading report totals…')).toBeInTheDocument();
    expect(screen.queryByText('Central Davis')).not.toBeInTheDocument();
    expect(screen.queryByText('No reports yet')).not.toBeInTheDocument();
  });

  it('shows the "Elsewhere in Davis" bucket only when the server reports one', async () => {
    fetchMock.mockResolvedValue(
      resp({
        areas: [
          ...DAVIS_AREAS.map((a) => ({ name: a.name, count: 1 })),
          { name: ELSEWHERE_AREA, count: 2 },
        ],
      }),
    );
    render(<CoverageView hazards={[]} />);
    await waitFor(() => expect(screen.getByText(ELSEWHERE_AREA)).toBeInTheDocument());
  });

  it('has no axe violations once loaded', async () => {
    const { container } = render(<CoverageView hazards={[feedHazard]} />);
    await waitFor(() => expect(screen.getByText('4 reports')).toBeInTheDocument());
    await checkA11y(container);
  });
});
