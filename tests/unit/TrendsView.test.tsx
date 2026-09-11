/**
 * TrendsView (issue #180): the table says what `/api/trends` says, in the view's
 * own words, and prints no number it cannot support -- not while loading, not
 * after a failure, and not as a row of zeros for a store that has received nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { ALL_AREAS, TrendsView, trendRows } from '../../src/components/TrendsView.tsx';
import { checkA11y } from '../axe.ts';
import type { ReportTrends } from '../../shared/recurrence.ts';

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const TRENDS: ReportTrends = {
  timeZone: 'America/Los_Angeles',
  months: [
    {
      month: '2026-01',
      areas: [
        { name: 'North Davis', received: 2, confirmed: 1, resolved: 0 },
        { name: 'South Davis', received: 0, confirmed: 0, resolved: 0 },
      ],
    },
    {
      month: '2026-03',
      areas: [
        { name: 'North Davis', received: 1, confirmed: 0, resolved: 1 },
        { name: 'South Davis', received: 4, confirmed: 2, resolved: 3 },
      ],
    },
  ],
  omittedMonths: 1,
  seedExcluded: 2,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => resp({ ...TRENDS, basis: 'b', limits: 'l' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every body row of the table as the texts of its cells, header cell first. */
function tableRows(): string[][] {
  const table = screen.getByRole('table');
  return [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );
}

describe('trendRows', () => {
  it('sums every area for "all areas", newest month first', () => {
    expect(trendRows(TRENDS, ALL_AREAS)).toEqual([
      { month: '2026-03', received: 5, confirmed: 2, resolved: 4 },
      { month: '2026-01', received: 2, confirmed: 1, resolved: 0 },
    ]);
  });

  it("gives one area's own counts, including a real zero", () => {
    expect(trendRows(TRENDS, 'South Davis')).toEqual([
      { month: '2026-03', received: 4, confirmed: 2, resolved: 3 },
      { month: '2026-01', received: 0, confirmed: 0, resolved: 0 },
    ]);
  });
});

describe('TrendsView', () => {
  it('asks /api/trends, and shows every month newest first, summed over all areas', async () => {
    render(<TrendsView />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trends');
    expect(tableRows()).toEqual([
      ['March 2026', '5', '2', '4'],
      ['January 2026', '2', '1', '0'],
    ]);
    expect(screen.getByText('Reports received each month, all areas')).toBeInTheDocument();
  });

  it("shows one area's months when an area is chosen", async () => {
    render(<TrendsView />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Area'), 'South Davis');
    expect(tableRows()).toEqual([
      ['March 2026', '4', '2', '3'],
      ['January 2026', '0', '0', '0'],
    ]);
    expect(screen.getByText('Reports received each month in South Davis')).toBeInTheDocument();
  });

  it('names the months it left out and the demo data it did not count', async () => {
    render(<TrendsView />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(
      screen.getByText(/1 month in this span had no reports anywhere and is left out rather than shown as zero/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 illustrative demo hazards are not counted/)).toBeInTheDocument();
    expect(screen.getByText(/a past month can still change/)).toBeInTheDocument();
  });

  it('says it could not load, and prints no numbers, when the endpoint fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(<TrendsView />);
    expect(await screen.findByRole('note')).toHaveTextContent(/could not be loaded/);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('prints no numbers while it is still loading', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<TrendsView />);
    expect(screen.getByText('Loading monthly totals…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says nothing has been reported yet, rather than showing a month of zeros, for an empty store', async () => {
    fetchMock.mockResolvedValue(resp({ ...TRENDS, months: [], omittedMonths: 0, seedExcluded: 0 }));
    render(<TrendsView />);
    expect(await screen.findByText(/No reports have been received yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says what it counts: reports received, never how often something happened', async () => {
    render(<TrendsView />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/not how often something happened/);
    expect(text).toMatch(/never to rank neighbourhoods/);
  });

  it('has no accessibility violations with the table on screen', async () => {
    const { container } = render(<TrendsView />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    // Content first: a scan of a view whose table never rendered would pass.
    expect(tableRows()).toHaveLength(2);
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    await checkA11y(container);
  });
});
