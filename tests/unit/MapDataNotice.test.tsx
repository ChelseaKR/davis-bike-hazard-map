/**
 * The map must not publish a failed read as a measurement.
 *
 * `ListView` announces the feed error and withholds its "none reported here"
 * wording while one is set; `CoverageView` withholds its data-desert flags
 * when `/api/coverage` cannot be reached. The map had neither: it never
 * received `error`, so a failed fetch produced an empty (or silently stale)
 * map under a caption reading "Empty areas mean no reports, not guaranteed
 * safety" — asserting that nothing had been reported when the truth was that
 * nothing had been *loaded*. On the surface a rider actually acts on.
 *
 * `MapDataNotice` is exported and rendered outside `<MapContainer>` precisely
 * so this is testable without Leaflet, the same reason `buildPopup` is.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { MapDataNotice } from '../../src/components/MapView.tsx';

describe('MapDataNotice', () => {
  it('says empty areas mean "no reports" only when the feed actually loaded', () => {
    render(<MapDataNotice feedError={null} />);
    expect(screen.getByText(/empty areas mean no reports/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('withdraws the "no reports" claim when the feed could not be loaded', () => {
    render(<MapDataNotice feedError="Network request failed" />);

    // The claim the caption would otherwise make is gone, not merely qualified.
    expect(screen.queryByText(/empty areas mean no reports/i)).not.toBeInTheDocument();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/hazard feed could not be loaded/i);
    expect(alert).toHaveTextContent(/did not arrive/i);
  });

  it('surfaces the underlying failure rather than swallowing it', () => {
    render(<MapDataNotice feedError="HTTP 503" />);
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503');
  });

  it('offers the same retry the list view does', async () => {
    const onRetry = vi.fn();
    render(<MapDataNotice feedError="offline" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry control when there is nothing to retry with', () => {
    render(<MapDataNotice feedError="offline" />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
