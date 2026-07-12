/**
 * A single hazard, rendered as an accessible card for the list view.
 *
 * Severity is conveyed by shape + text label as well as colour (never colour
 * alone — accessibility), and every card carries the "reported, not verified"
 * framing the transparency audit requires.
 */
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { lifecycleStage, type Hazard } from '../../shared/types.ts';
import { timeAgo, formatLatLng } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';
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
  now,
}: HazardCardProps) {
  const [renderedAt] = useState(Date.now);
  const effectiveNow = now ?? renderedAt;
  const intl = useIntl();
  const labels = useLabels();
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
          {labels.category(hazard.category)}
          <span className="visually-hidden">
            <FormattedMessage
              id="hazard.card.severitySr"
              defaultMessage=", {severity} severity"
              values={{ severity: labels.severity(hazard.severity) }}
            />
          </span>
        </h3>
        <span className={`lifecycle-badge lifecycle-${stage}`}>
          {labels.lifecycle(stage)}
        </span>
        <span className={`severity-text severity-text-${hazard.severity}`}>
          {labels.severity(hazard.severity)}
        </span>
      </div>

      {stage === 'resolved' && (
        <p className="hazard-resolved-note">
          <FormattedMessage
            id="hazard.card.resolvedNote"
            defaultMessage="Reported fixed{when} — shown briefly so you know it was addressed."
            values={{ when: hazard.resolvedAt ? ` ${timeAgo(hazard.resolvedAt, effectiveNow)}` : '' }}
          />
        </p>
      )}

      {hazard.handoff && (
        <p className="hazard-handoff-note">
          <FormattedMessage
            id="hazard.card.handoff"
            defaultMessage="City 311: {status}"
            values={{ status: labels.handoff(hazard.handoff.stage) }}
          />
        </p>
      )}

      {hazard.description && <p className="hazard-desc">{hazard.description}</p>}

      {hazard.photoUrl && (
        <HazardPhoto
          className="hazard-photo"
          src={hazard.thumbnailUrl ?? hazard.photoUrl}
          alt={intl.formatMessage(
            { id: 'hazard.card.photoAlt', defaultMessage: 'Reported {category} hazard' },
            { category: labels.category(hazard.category).toLowerCase() },
          )}
        />
      )}

      <dl className="hazard-meta">
        <div>
          <dt>
            <FormattedMessage id="hazard.card.reportedLabel" defaultMessage="Reported" />
          </dt>
          <dd>{timeAgo(hazard.updatedAt, effectiveNow)}</dd>
        </div>
        <div>
          <dt>
            <FormattedMessage id="hazard.card.confirmationsLabel" defaultMessage="Confirmations" />
          </dt>
          <dd>{hazard.confirmations}</dd>
        </div>
        <div>
          <dt>
            <FormattedMessage id="hazard.card.locationLabel" defaultMessage="Approx. location" />
          </dt>
          <dd>{formatLatLng(hazard.location.lat, hazard.location.lng)}</dd>
        </div>
      </dl>

      <p className="hazard-note">
        <FormattedMessage
          id="hazard.card.note"
          defaultMessage="Community-reported — not verified by the city."
        />
      </p>

      <div className="hazard-actions">
        {onConfirm && stage !== 'resolved' && stage !== 'expired' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onConfirm(hazard.id)}
          >
            <FormattedMessage id="hazard.card.confirm" defaultMessage="I saw this too" />
          </button>
        )}
        {onFocusOnMap && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onFocusOnMap(hazard)}
          >
            <FormattedMessage id="hazard.card.showOnMap" defaultMessage="Show on map" />
          </button>
        )}
      </div>
    </li>
  );
}
