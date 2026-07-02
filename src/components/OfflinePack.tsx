/**
 * "Save Davis for offline" (EXP-02).
 *
 * Opt-in panel that pre-fetches every map tile covering Davis into the
 * service-worker tile cache, so the map works offline across the whole city.
 * Shows the tile count + a size estimate before starting, a live progress bar
 * while running, and a done/error summary. When the app is pointed at the
 * public OpenStreetMap tile servers the whole feature is disabled (bulk
 * pre-fetching violates OSM's tile-usage policy) with an explanatory note.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { config } from '../config.ts';
import {
  downloadTilePack,
  estimatedTilePackBytes,
  isBulkDownloadAllowed,
  tilePackCount,
  type TilePackProgress,
  type TilePackResult,
} from '../lib/tilePack.ts';

type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

function megabytes(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function OfflinePack() {
  const intl = useIntl();
  const allowed = isBulkDownloadAllowed(config.tileUrl);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<TilePackProgress | null>(null);
  const [result, setResult] = useState<TilePackResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const total = useMemo(() => tilePackCount(), []);
  const estMb = useMemo(() => megabytes(estimatedTilePackBytes()), []);

  const start = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setResult(null);
    setErrorMessage('');
    setProgress({ total, completed: 0, fetched: 0, skipped: 0, failed: 0 });
    setPhase('running');
    try {
      const res = await downloadTilePack({
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult(res);
      setPhase('done');
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        setPhase('cancelled');
      } else {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [total]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return (
    <section className="offline-pack" aria-labelledby="offline-pack-title">
      <h3 id="offline-pack-title">
        <FormattedMessage id="offline.title" defaultMessage="Save Davis for offline" />
      </h3>
      <p className="hint">
        <FormattedMessage
          id="offline.explain"
          defaultMessage="Download every map tile for Davis so the map works with no signal — anywhere in town, not just where you've already looked."
        />
      </p>

      {!allowed ? (
        <p className="hint offline-hint" role="note">
          <FormattedMessage
            id="offline.disabled"
            defaultMessage="Offline packs are unavailable on the shared OpenStreetMap tiles — bulk downloads aren't allowed by their usage policy. Point the app at self-hosted tiles to enable this."
          />
        </p>
      ) : (
        <>
          {phase === 'idle' && (
            <>
              <p className="offline-estimate">
                <FormattedMessage
                  id="offline.estimate"
                  defaultMessage="About {count, number} tiles · roughly {mb} MB of storage."
                  values={{
                    count: total,
                    mb: intl.formatNumber(estMb, { maximumFractionDigits: 0 }),
                  }}
                />
              </p>
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                <FormattedMessage id="offline.start" defaultMessage="Download Davis tiles" />
              </button>
            </>
          )}

          {phase === 'running' && progress && (
            <div className="offline-progress">
              <div
                className="offline-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={intl.formatMessage({
                  id: 'offline.progressLabel',
                  defaultMessage: 'Downloading Davis tiles',
                })}
              >
                <span className="offline-bar-fill" style={{ inlineSize: `${pct}%` }} />
              </div>
              <p className="hint" role="status" aria-live="polite">
                <FormattedMessage
                  id="offline.progress"
                  defaultMessage="{completed, number} of {total, number} tiles ({pct, number}%)"
                  values={{ completed: progress.completed, total: progress.total, pct }}
                />
              </p>
              <button type="button" className="btn btn-small" onClick={cancel}>
                <FormattedMessage id="offline.cancel" defaultMessage="Cancel" />
              </button>
            </div>
          )}

          {phase === 'done' && result && (
            <p className="offline-done" role="status">
              <FormattedMessage
                id="offline.done"
                defaultMessage="Done — {fetched, number} tiles saved, {skipped, number} already cached{failed, plural, =0 {} other {, # failed}}. Davis is available offline."
                values={{ fetched: result.fetched, skipped: result.skipped, failed: result.failed }}
              />
            </p>
          )}

          {phase === 'cancelled' && (
            <p className="hint" role="status">
              <FormattedMessage
                id="offline.cancelled"
                defaultMessage="Download cancelled — tiles fetched so far are kept."
              />{' '}
              <button type="button" className="btn btn-small" onClick={() => void start()}>
                <FormattedMessage id="offline.resume" defaultMessage="Resume" />
              </button>
            </p>
          )}

          {phase === 'error' && (
            <p className="error-text" role="alert">
              <FormattedMessage
                id="offline.error"
                defaultMessage="Download failed: {message}"
                values={{ message: errorMessage }}
              />{' '}
              <button type="button" className="btn btn-small" onClick={() => void start()}>
                <FormattedMessage id="offline.retry" defaultMessage="Try again" />
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
