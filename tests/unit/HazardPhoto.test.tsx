import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HazardPhoto } from '../../src/components/HazardPhoto.tsx';

describe('HazardPhoto', () => {
  it('renders the image with alt text and lazy loading', () => {
    render(<HazardPhoto src="/api/photos/h1" alt="A pothole" className="x" />);
    const img = screen.getByRole('img', { name: 'A pothole' });
    expect(img).toHaveAttribute('src', '/api/photos/h1');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveClass('x');
  });

  it('degrades to an accessible caption when the image fails to load', () => {
    render(<HazardPhoto src="/api/photos/missing" alt="A pothole" />);
    fireEvent.error(screen.getByRole('img'));
    const fallback = screen.getByRole('img', { name: /a pothole — photo unavailable/i });
    expect(fallback).toHaveTextContent(/photo unavailable/i);
    expect(fallback.tagName).toBe('P');
  });
});
