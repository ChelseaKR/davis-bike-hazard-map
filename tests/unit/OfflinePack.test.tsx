import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';

// Control the tile-pack driver so the component test is deterministic and never
// touches the network or Cache Storage.
const mocks = vi.hoisted(() => ({
  isBulkDownloadAllowed: vi.fn(),
  downloadTilePack: vi.fn(),
}));

vi.mock('../../src/lib/tilePack.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/tilePack.ts')>();
  return {
    ...actual,
    isBulkDownloadAllowed: mocks.isBulkDownloadAllowed,
    downloadTilePack: mocks.downloadTilePack,
  };
});

import { OfflinePack } from '../../src/components/OfflinePack.tsx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OfflinePack', () => {
  it('shows a disabled note when bulk download is not allowed (default OSM tiles)', () => {
    mocks.isBulkDownloadAllowed.mockReturnValue(false);
    render(<OfflinePack />);
    expect(screen.getByRole('note')).toHaveTextContent(/usage policy/i);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the tile count + size estimate and a start button when allowed', () => {
    mocks.isBulkDownloadAllowed.mockReturnValue(true);
    render(<OfflinePack />);
    // 2391 tiles for the full Davis pack.
    expect(screen.getByText(/2,391 tiles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download davis tiles/i })).toBeInTheDocument();
  });

  it('runs the download and reports a done summary', async () => {
    mocks.isBulkDownloadAllowed.mockReturnValue(true);
    mocks.downloadTilePack.mockImplementation(async ({ onProgress }) => {
      onProgress?.({ total: 2391, completed: 2391, fetched: 2380, skipped: 11, failed: 0 });
      return { fetched: 2380, skipped: 11, failed: 0, bytes: 2380 * 20000 };
    });

    render(<OfflinePack />);
    await userEvent.click(screen.getByRole('button', { name: /download davis tiles/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/2,380 tiles saved/i),
    );
    expect(mocks.downloadTilePack).toHaveBeenCalledOnce();
  });

  it('surfaces an error state with a retry when the download fails', async () => {
    mocks.isBulkDownloadAllowed.mockReturnValue(true);
    mocks.downloadTilePack.mockRejectedValue(new Error('network down'));

    render(<OfflinePack />);
    await userEvent.click(screen.getByRole('button', { name: /download davis tiles/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network down/i));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
