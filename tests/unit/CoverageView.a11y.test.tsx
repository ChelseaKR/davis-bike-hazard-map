import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageView } from '../../src/components/CoverageView.tsx';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

function at(lat: number, lng: number, id: string): Hazard {
  return {
    id,
    clientId: id,
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

describe('CoverageView', () => {
  it('frames empty areas as under-reported, not safe', () => {
    render(<CoverageView hazards={[]} />);
    expect(screen.getByText(/under-reported/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no reports yet/i).length).toBeGreaterThan(0);
  });

  it('shows counts as accessible text', () => {
    render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);
    expect(screen.getByText(/1 report\b/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CoverageView hazards={[at(38.57, -121.74, 'n')]} />);
    await checkA11y(container);
  });
});
