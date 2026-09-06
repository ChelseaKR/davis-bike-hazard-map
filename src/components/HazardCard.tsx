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
import { useNow } from '../lib/useNow.ts';
import { useLabels } from '../i18n/labels.ts';
import { HazardPhoto } from './HazardPhoto.tsx';

interface HazardCardProps {
  hazard: Hazard;
  /**
   * Confirm this hazard. May resolve to whether the confirmation actually
   * COUNTED — false meaning this device already confirmed it inside the server's
   * window (#177). Resolving to `undefined` means the caller did not say, and the
   * card then claims nothing.
   */
  onConfirm?: (id: string) => void | Promise<boolean | void>;
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
  const effectiveNow = useNow(now);
  const intl = useIntl();
  // What the last confirmation from this device did. `null` is "nothing to say"
  // and is NOT the same as "it counted": a suppressed confirmation that showed
  // no feedback would read as a broken button, and the next thing a rider does
  // with a broken button is press it again.
  const [confirmNote, setConfirmNote] = useState<'counted' | 'already' | null>(null);
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
        {hazard.source === 'seed' && (
          <span className="demo-badge">
            <FormattedMessage id="hazard.card.demoBadge" defaultMessage="Demo data" />
          </span>
        )}
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
        <p
          className={`hazard-handoff-note hazard-handoff-${hazard.handoff.delivery}`}
        >
          {labels.handoffNote(hazard.handoff)}
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
        {hazard.source === 'seed' ? (
          <FormattedMessage
            id="hazard.card.demoNote"
            defaultMessage="Demo data — a fictional example, not a real report."
          />
        ) : (
          <FormattedMessage
            id="hazard.card.note"
            defaultMessage="Community-reported — not verified by the city."
          />
        )}
      </p>

      <div className="hazard-actions">
        {onConfirm && stage !== 'resolved' && stage !== 'expired' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              void (async () => {
                const counted = await onConfirm(hazard.id);
                // Only an explicit boolean is a claim. `undefined` means the
                // caller reported nothing, so inventing "counted" here would put
                // a sentence in front of a rider that nothing verified.
                if (counted === true) setConfirmNote('counted');
                else if (counted === false) setConfirmNote('already');
              })();
            }}
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

      {confirmNote && (
        <p className="hazard-confirm-note" role="status">
          {confirmNote === 'counted' ? (
            <FormattedMessage
              id="hazard.card.confirmCounted"
              defaultMessage="Thanks — your confirmation was counted."
            />
          ) : (
            <FormattedMessage
              id="hazard.card.confirmAlready"
              defaultMessage="You already confirmed this one, so the count stays where it is. Confirmations are counted once per device so the number means riders, not taps."
            />
          )}
        </p>
      )}
    </li>
  );
}
