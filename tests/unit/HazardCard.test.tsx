import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { HazardCard } from '../../src/components/HazardCard.tsx';
import type { Hazard } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
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

  it('says the confirmation counted when the caller reports true', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    renderCard({ hazard: hazard(), onConfirm, now: NOW });
    await userEvent.click(screen.getByRole('button', { name: /i saw this too/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/counted/i);
  });

  it('says the count stays put when this device already confirmed it (#177)', async () => {
    // The point of surfacing it at all: a suppressed confirmation moves no
    // number, and a button that appears to do nothing gets pressed again.
    const onConfirm = vi.fn().mockResolvedValue(false);
    renderCard({ hazard: hazard(), onConfirm, now: NOW });
    await userEvent.click(screen.getByRole('button', { name: /i saw this too/i }));
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/already confirmed this one/i);
    expect(note).toHaveTextContent(/riders, not taps/i);
  });

  it('claims NOTHING when the caller does not say whether it counted', async () => {
    // `undefined` is what App returns on a network error, and what a plain
    // `vi.fn()` returns. Rendering "counted" from it would put a sentence in
    // front of a rider that nothing verified — the absence-as-a-value shape.
    const onConfirm = vi.fn();
    renderCard({ hazard: hazard(), onConfirm, now: NOW });
    await userEvent.click(screen.getByRole('button', { name: /i saw this too/i }));
    expect(onConfirm).toHaveBeenCalledWith('h1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it('marks a seeded (demo) hazard with a "Demo data" badge and note (issue #111)', () => {
    renderCard({ hazard: hazard({ source: 'seed' }), now: NOW });
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(
      screen.getByText(/demo data.*fictional example, not a real report/i),
    ).toBeInTheDocument();
    // The seeded framing must replace, not sit alongside, the real-report claim.
    expect(screen.queryByText(/community-reported/i)).toBeNull();
  });

  it('does NOT mark a real report as demo data', () => {
    renderCard({ hazard: hazard({ source: 'report' }), now: NOW });
    expect(screen.queryByText('Demo data')).toBeNull();
    expect(screen.getByText(/not verified by the city/i)).toBeInTheDocument();
  });

  it('does NOT mark a hazard with an unset source (legacy data) as demo data', () => {
    renderCard({ hazard: hazard(), now: NOW });
    expect(screen.queryByText('Demo data')).toBeNull();
  });

  const handoffAt = (
    stage: 'in_progress' | 'submitted',
    delivery: 'delivered' | 'dry_run' | 'undelivered' | 'unknown',
  ) => ({
    provider: 'gogov',
    reference: 'h1',
    externalStatus: stage,
    stage,
    delivery,
    submittedAt: NOW - 5000,
    updatedAt: NOW - 1000,
    note: null,
  });

  it('surfaces the synced-back 311 hand-off status', () => {
    renderCard({ hazard: hazard({ handoff: handoffAt('in_progress', 'delivered') }), now: NOW });
    expect(screen.getByText(/city 311: city crew assigned/i)).toBeInTheDocument();
  });

  // Issue #162: `stage` is recorded as 'submitted' the moment a forward is
  // ATTEMPTED, dry-run or not, so rendering it alone published a civic action
  // that never happened.
  it('does NOT render a dry-run hand-off as sent to the city', () => {
    renderCard({ hazard: hazard({ handoff: handoffAt('submitted', 'dry_run') }), now: NOW });
    expect(screen.queryByText(/city 311: sent to city 311/i)).toBeNull();
    expect(screen.getByText(/not sent/i)).toBeInTheDocument();
    expect(screen.getByText(/no 311 provider is configured/i)).toBeInTheDocument();
  });

  it('does NOT render a failed hand-off as sent to the city', () => {
    renderCard({ hazard: hazard({ handoff: handoffAt('submitted', 'undelivered') }), now: NOW });
    expect(screen.queryByText(/city 311: sent to city 311/i)).toBeNull();
    expect(screen.getByText(/not delivered/i)).toBeInTheDocument();
  });

  it('does NOT render an unrecorded delivery as a completed one', () => {
    renderCard({ hazard: hazard({ handoff: handoffAt('submitted', 'unknown') }), now: NOW });
    expect(screen.queryByText(/city 311: sent to city 311/i)).toBeNull();
    expect(screen.getByText(/delivery was not recorded/i)).toBeInTheDocument();
  });
});
