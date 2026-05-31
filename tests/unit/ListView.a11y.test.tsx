import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListView } from '../../src/components/ListView.tsx';
import type { Hazard } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;

function hazard(id: string, over: Partial<Hazard> = {}): Hazard {
  return {
    id,
    clientId: `c-${id}`,
    category: 'pothole',
    severity: 'high',
    description: 'A hazard',
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 1_000_000,
    ...over,
  };
}

describe('ListView (accessibility & parity)', () => {
  it('has no accessibility violations with hazards', async () => {
    const { container } = render(
      <ListView
        hazards={[hazard('a'), hazard('b', { severity: 'low' })]}
        loading={false}
        error={null}
        onConfirm={vi.fn()}
      />,
    );
    const { checkA11y } = await import('../axe.ts');
    await checkA11y(container);
  });

  it('frames an empty result as "no reports", not "safe"', () => {
    render(<ListView hazards={[]} loading={false} error={null} />);
    expect(screen.getByText(/no hazards match/i)).toBeInTheDocument();
    expect(screen.getByText(/not that the area is safe/i)).toBeInTheDocument();
  });

  it('surfaces load errors to assistive tech', () => {
    render(<ListView hazards={[]} loading={false} error="Network down" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
  });
});
