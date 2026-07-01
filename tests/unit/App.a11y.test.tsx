import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { _resetDbForTests } from '../../src/lib/db.ts';
import { checkA11y } from '../axe.ts';

// Leaflet doesn't render meaningfully in jsdom; stub the lazy map so the App
// tree is exercised without a real map. Map a11y is covered by the e2e pass.
vi.mock('../../src/components/MapView.tsx', () => ({
  MapView: () => <div data-testid="map-stub">map</div>,
}));

beforeEach(async () => {
  await _resetDbForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hazards: [] }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders core landmarks and has no a11y violations on the map view', async () => {
    const { container } = render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /views/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    await screen.findByTestId('map-stub');
    await checkA11y(container);
  });

  it('switches to the accessible list view (map/list parity)', async () => {
    const { container } = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(screen.getByLabelText(/hazard list/i)).toBeInTheDocument());
    await checkA11y(container);
  });

  it('renders the report tab accessibly', async () => {
    const { container } = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Report' }));
    await screen.findByRole('button', { name: /submit report/i });
    await checkA11y(container);
  });

  it('renders the moderation sign-in accessibly', async () => {
    const { container } = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Moderate' }));
    await screen.findByLabelText(/username/i);
    await screen.findByLabelText(/password/i);
    await checkA11y(container);
  });
});
