import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import { CoverageView } from '../../src/components/CoverageView.tsx';
import { checkA11y } from '../axe.ts';
import { DAVIS_AREAS } from '../../shared/areas.ts';
import type { Hazard } from '../../shared/types.ts';

function at(lat: number, lng: number, id: string): Hazard {
  return {
    id,
    category: 'pothole',
    severity: 'low',
    description: null,
    location: { lat, lng },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
  };
}

/**
 * Stand in for GET /api/coverage — reports RECEIVED per area, which is what the
 * view renders. The `hazards` prop is only the offline fallback, so these tests
 * drive the endpoint rather than the prop.
 */
function coverage(counts: Record<string, number>) {
  const body = {
    areas: DAVIS_AREAS.map((a) => ({ name: a.name, count: counts[a.name] ?? 0 })),
  };
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => coverage({})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CoverageView', () => {
  it('frames empty areas as under-reported, not safe', async () => {
    render(<CoverageView hazards={[]} />);
    await waitFor(() =>
      expect(screen.getAllByText(/no reports yet/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/under-reported/i)).toBeInTheDocument();
  });

  it('shows counts as accessible text', async () => {
    vi.mocked(fetch).mockResolvedValue(coverage({ 'North Davis': 1 }));
    render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);
    await waitFor(() => expect(screen.getByText(/1 report\b/i)).toBeInTheDocument());
  });

  it('calls out data deserts and pairs normalization with a limits note', async () => {
    // Only North Davis has been reported; the high-ridership campus has not.
    vi.mocked(fetch).mockResolvedValue(coverage({ 'North Davis': 1 }));
    render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);

    const callout = await screen.findByRole('note');
    expect(callout).toHaveTextContent(/data deserts/i);
    expect(callout).toHaveTextContent(/UC Davis campus/);
    // The limits note must be present so normalization is never read as ranking.
    expect(screen.getByText(/rough heuristic, not measured exposure data/i)).toBeInTheDocument();
    expect(screen.getByText(/absence of reports is absence of/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    vi.mocked(fetch).mockResolvedValue(coverage({ 'North Davis': 1 }));
    const { container } = render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);
    await waitFor(() => expect(screen.getByText(/1 report\b/i)).toBeInTheDocument());
    await checkA11y(container);
  });

  it('has no accessibility violations in the fallback (feed-only) state', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const { container } = render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);
    await waitFor(() => expect(screen.getByText(/Partial view:/)).toBeInTheDocument());
    await checkA11y(container);
  });
});
