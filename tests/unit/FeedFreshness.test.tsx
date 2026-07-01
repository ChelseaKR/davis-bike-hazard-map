import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { FeedFreshness } from '../../src/components/FeedFreshness.tsx';

const NOW = 1_700_000_000_000;

describe('FeedFreshness', () => {
  it('shows when the feed was last updated', () => {
    render(<FeedFreshness updatedAt={NOW - 5 * 60_000} loading={false} onRefresh={() => {}} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent(/updated/i);
  });

  it('shows an updating state and disables refresh while loading', () => {
    render(<FeedFreshness updatedAt={NOW} loading onRefresh={() => {}} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent(/updating/i);
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('calls onRefresh when the button is pressed', async () => {
    const onRefresh = vi.fn();
    render(<FeedFreshness updatedAt={NOW} loading={false} onRefresh={onRefresh} now={NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('handles the never-loaded state', () => {
    render(<FeedFreshness updatedAt={null} loading={false} onRefresh={() => {}} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent(/not loaded yet/i);
  });
});
