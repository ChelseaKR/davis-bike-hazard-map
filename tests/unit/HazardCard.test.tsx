import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { HazardCard } from '../../src/components/HazardCard.tsx';
import type { Hazard } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole in the lane',
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 2,
    createdAt: NOW - 5000,
    updatedAt: NOW - 5000,
    expiresAt: NOW + 1_000_000,
    ...over,
  };
}

function renderCard(props: Parameters<typeof HazardCard>[0]) {
  return render(
    <ul>
      <HazardCard {...props} />
    </ul>,
  );
}

describe('HazardCard', () => {
  it('shows the category and severity (text, not colour alone)', () => {
    renderCard({ hazard: hazard(), now: NOW });
    expect(screen.getByRole('heading', { name: /pothole/i })).toBeInTheDocument();
    expect(screen.getAllByText(/high/i).length).toBeGreaterThan(0);
  });

  it('carries the "not verified" transparency framing', () => {
    renderCard({ hazard: hazard(), now: NOW });
    expect(screen.getByText(/not verified by the city/i)).toBeInTheDocument();
  });

  it('calls onConfirm with the hazard id', async () => {
    const onConfirm = vi.fn();
    renderCard({ hazard: hazard(), onConfirm, now: NOW });
    await userEvent.click(screen.getByRole('button', { name: /i saw this too/i }));
    expect(onConfirm).toHaveBeenCalledWith('h1');
  });

  it('calls onFocusOnMap when asked to show on map', async () => {
    const onFocusOnMap = vi.fn();
    const h = hazard();
    renderCard({ hazard: h, onFocusOnMap, now: NOW });
    await userEvent.click(screen.getByRole('button', { name: /show on map/i }));
    expect(onFocusOnMap).toHaveBeenCalledWith(h);
  });

  it('renders a photo with descriptive alt text when present', () => {
    renderCard({ hazard: hazard({ photoUrl: '/api/photos/h1' }), now: NOW });
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/api/photos/h1');
    expect(img.getAttribute('alt')).toMatch(/pothole/i);
  });

  it('shows a "Confirmed" lifecycle badge once confirmed', () => {
    renderCard({ hazard: hazard({ confirmations: 2 }), now: NOW });
    expect(screen.getByText('Confirmed', { selector: '.lifecycle-badge' })).toBeInTheDocument();
  });

  it('shows "Reported" before any confirmation', () => {
    renderCard({ hazard: hazard({ confirmations: 0 }), now: NOW });
    expect(screen.getByText('Reported', { selector: '.lifecycle-badge' })).toBeInTheDocument();
  });

  it('marks a resolved hazard, notes the fix, and hides the confirm action', () => {
    const onConfirm = vi.fn();
    renderCard({
      hazard: hazard({ status: 'resolved', resolvedAt: NOW - 1000 }),
      onConfirm,
      now: NOW,
    });
    expect(screen.getByText('Resolved', { selector: '.lifecycle-badge' })).toBeInTheDocument();
    expect(screen.getByText(/reported fixed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /i saw this too/i })).toBeNull();
  });

  it('surfaces the synced-back 311 hand-off status', () => {
    renderCard({
      hazard: hazard({
        handoff: {
          provider: 'gogov',
          reference: 'h1',
          externalStatus: 'In Progress',
          stage: 'in_progress',
          submittedAt: NOW - 5000,
          updatedAt: NOW - 1000,
          note: null,
        },
      }),
      now: NOW,
    });
    expect(screen.getByText(/city 311: city crew assigned/i)).toBeInTheDocument();
  });
});
