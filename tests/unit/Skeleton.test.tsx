/**
 * Loading placeholders. The a11y invariant: skeletons are decorative and MUST
 * be hidden from assistive tech (aria-hidden) so a screen reader announces real
 * content when it arrives, not a wall of shimmering placeholder nodes.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkeletonList, SkeletonMap } from '../../src/components/Skeleton.tsx';

describe('SkeletonList', () => {
  it('renders the requested number of placeholder cards, hidden from assistive tech', () => {
    const { container } = render(<SkeletonList count={5} />);
    const list = container.querySelector('ul.hazard-list');
    expect(list).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('li.skeleton-card')).toHaveLength(5);
  });

  it('defaults to three placeholder cards', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('li.skeleton-card')).toHaveLength(3);
  });
});

describe('SkeletonMap', () => {
  it('is a decorative placeholder hidden from assistive tech', () => {
    const { container } = render(<SkeletonMap />);
    const el = container.querySelector('.skeleton-map');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });
});
