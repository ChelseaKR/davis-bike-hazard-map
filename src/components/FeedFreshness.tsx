/**
 * A small "Updated N min ago · Refresh" line for the map and list views, so a
 * cyclist can tell whether the data is fresh and pull it again on demand. The
 * status text is a polite live region so screen-reader users hear updates.
 */
import { FormattedMessage } from 'react-intl';
import { timeAgo } from '../lib/format.ts';

interface FeedFreshnessProps {
  /** Epoch ms of the last successful load, or null before the first. */
  updatedAt: number | null;
  loading: boolean;
  onRefresh: () => void;
  now?: number;
}

export function FeedFreshness({ updatedAt, loading, onRefresh, now = Date.now() }: FeedFreshnessProps) {
  return (
    <div className="feed-freshness">
      <span className="hint" role="status" aria-live="polite">
        {loading ? (
          <FormattedMessage id="feed.updating" defaultMessage="Updating…" />
        ) : updatedAt ? (
          <FormattedMessage
            id="feed.updated"
            defaultMessage="Updated {when}"
            values={{ when: timeAgo(updatedAt, now) }}
          />
        ) : (
          <FormattedMessage id="feed.notLoaded" defaultMessage="Not loaded yet" />
        )}
      </span>
      <button
        type="button"
        className="btn btn-small"
        onClick={onRefresh}
        disabled={loading}
      >
        <FormattedMessage id="common.refresh" defaultMessage="Refresh" />
      </button>
    </div>
  );
}
