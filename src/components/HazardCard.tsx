/**
 * A single hazard, rendered as an accessible card for the list view.
 *
 * Severity is conveyed by shape + text label as well as colour (never colour
 * alone — accessibility), and every card carries the "reported, not verified"
 * framing the transparency audit requires.
 */
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  LIFECYCLE_LABELS,
  HANDOFF_STAGE_LABELS,
  lifecycleStage,
  type Hazard,
} from '../../shared/types.ts';
import { timeAgo, formatLatLng } from '../lib/format.ts';
import { HazardPhoto } from './HazardPhoto.tsx';

interface HazardCardProps {
  hazard: Hazard;
  onConfirm?: (id: string) => void;
  onFocusOnMap?: (hazard: Hazard) => void;
  now?: number;
}

const SEVERITY_SHAPE: Record<Hazard['severity'], string> = {
  low: '▲',
  moderate: '◆',
  high: '⬢',
};

export function HazardCard({
  hazard,
  onConfirm,
  onFocusOnMap,
  now = Date.now(),
}: HazardCardProps) {
  const stage = lifecycleStage(hazard);
  return (
    <li className={`hazard-card hazard-stage-${stage}`}>
      <div className="hazard-card-head">
        <span
          className={`severity-badge severity-${hazard.severity}`}
          aria-hidden="true"
        >
          {SEVERITY_SHAPE[hazard.severity]}
        </span>
        <h3 className="hazard-title">
          {CATEGORY_LABELS[hazard.category]}
          <span className="visually-hidden">
            , {SEVERITY_LABELS[hazard.severity]} severity
          </span>
        </h3>
        <span className={`lifecycle-badge lifecycle-${stage}`}>
          {LIFECYCLE_LABELS[stage]}
        </span>
        <span className={`severity-text severity-text-${hazard.severity}`}>
          {SEVERITY_LABELS[hazard.severity]}
        </span>
      </div>

      {stage === 'resolved' && (
        <p className="hazard-resolved-note">
          Reported fixed{hazard.resolvedAt ? ` ${timeAgo(hazard.resolvedAt, now)}` : ''} — shown
          briefly so you know it was addressed.
        </p>
      )}

      {hazard.handoff && (
        <p className="hazard-handoff-note">
          City 311: {HANDOFF_STAGE_LABELS[hazard.handoff.stage]}
        </p>
      )}

      {hazard.description && <p className="hazard-desc">{hazard.description}</p>}

      {hazard.photoUrl && (
        <HazardPhoto
          className="hazard-photo"
          src={hazard.thumbnailUrl ?? hazard.photoUrl}
          alt={`Reported ${CATEGORY_LABELS[hazard.category].toLowerCase()} hazard`}
        />
      )}

      <dl className="hazard-meta">
        <div>
          <dt>Reported</dt>
          <dd>{timeAgo(hazard.updatedAt, now)}</dd>
        </div>
        <div>
          <dt>Confirmations</dt>
          <dd>{hazard.confirmations}</dd>
        </div>
        <div>
          <dt>Approx. location</dt>
          <dd>{formatLatLng(hazard.location.lat, hazard.location.lng)}</dd>
        </div>
      </dl>

      <p className="hazard-note">Community-reported — not verified by the city.</p>

      <div className="hazard-actions">
        {onConfirm && stage !== 'resolved' && stage !== 'expired' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onConfirm(hazard.id)}
          >
            I saw this too
          </button>
        )}
        {onFocusOnMap && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onFocusOnMap(hazard)}
          >
            Show on map
          </button>
        )}
      </div>
    </li>
  );
}
