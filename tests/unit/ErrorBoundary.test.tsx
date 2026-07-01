import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../../src/components/ErrorBoundary.tsx';

// Telemetry beacons to the network; stub it so the boundary's report is silent.
vi.mock('../../src/lib/telemetry.ts', () => ({
  reportError: vi.fn(),
}));
import { reportError } from '../../src/lib/telemetry.ts';

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('kaboom');
  return <p>all good</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
    // React logs the caught error to console.error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('shows a recovery card and reports the error when a child throws', () => {
    render(
      <ErrorBoundary source="view:test">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0][1]).toMatchObject({
      source: 'view:test',
    });
  });

  it('recovers when "Try again" is clicked and the child no longer throws', async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('first render fails');
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The fix lands before the retry re-mounts the subtree.
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
