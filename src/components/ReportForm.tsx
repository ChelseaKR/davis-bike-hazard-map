/**
 * ReportForm — file a hazard in seconds, offline-first.
 *
 * Saves to the local IndexedDB queue immediately (works with no network) and
 * kicks a sync attempt when online. The photo path runs through PhotoEditor so
 * EXIF is stripped and blur is offered before anything is stored.
 */
import { Suspense, lazy, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  type GeoPoint,
  type Hazard,
  type HazardCategory,
  type ReportSubmission,
  type Severity,
} from '../../shared/types.ts';
import {
  MAX_DESCRIPTION_LEN,
  reportSubmissionSchema,
} from '../../shared/validation.ts';
import { isWithinDavis } from '../../shared/geo.ts';
import { enqueueReport } from '../lib/db.ts';
import { syncOnce, isOnline } from '../lib/sync.ts';
import { getCurrentLocation, GeolocationError } from '../lib/geolocation.ts';
import { newId } from '../lib/id.ts';
import { formatDistance, formatLatLng } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';
import { findNearbyDuplicates } from '../lib/dedupe.ts';
import { PhotoEditor } from './PhotoEditor.tsx';

// Leaflet is heavy; only pull it in when the user opens the map picker.
const LocationPicker = lazy(() => import('./LocationPicker.tsx'));

interface ReportFormProps {
  onSubmitted?: () => void;
  /**
   * The live public hazard feed, used to spot likely duplicates near the chosen
   * spot so the reporter can confirm an existing hazard instead of filing a new
   * one (research roadmap R1). Optional — without it the nudge simply never
   * shows.
   */
  nearbyHazards?: Hazard[];
  /** Confirm an existing hazard ("I saw it too"); wired to the same endpoint
   *  the map/list use. */
  onConfirmExisting?: (id: string) => void | Promise<void>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; online: boolean }
  | { kind: 'error'; message: string };

export function ReportForm({ onSubmitted, nearbyHazards, onConfirmExisting }: ReportFormProps) {
  const intl = useIntl();
  const labels = useLabels();
  const [category, setCategory] = useState<HazardCategory>('pothole');
  const [severity, setSeverity] = useState<Severity>('moderate');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [confirmedExisting, setConfirmedExisting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const locationValid = location !== null && isWithinDavis(location);

  // Likely duplicates of the same kind near the chosen spot (R1 dedupe nudge).
  const duplicates =
    location && locationValid
      ? findNearbyDuplicates(nearbyHazards ?? [], location, category)
      : [];

  const confirmExisting = async (id: string) => {
    try {
      await onConfirmExisting?.(id);
      setConfirmedExisting(true);
    } catch {
      // Best-effort: leave the nudge up so they can retry or file fresh.
    }
  };

  const useMyLocation = async () => {
    setGeoError(null);
    setLocating(true);
    try {
      const point = await getCurrentLocation();
      setLocation(point);
      if (!isWithinDavis(point)) {
        setGeoError(
          intl.formatMessage({
            id: 'report.geo.outside',
            defaultMessage: 'That location is outside Davis. Adjust it on the map.',
          }),
        );
        setShowMap(true);
      }
    } catch (err) {
      const msg =
        err instanceof GeolocationError && err.code === 'denied'
          ? intl.formatMessage({
              id: 'report.geo.denied',
              defaultMessage: 'Location permission denied. Set the spot on the map instead.',
            })
          : intl.formatMessage({
              id: 'report.geo.unavailable',
              defaultMessage: 'Could not get your location. Set the spot on the map instead.',
            });
      setGeoError(msg);
      setShowMap(true);
    } finally {
      setLocating(false);
    }
  };

  const reset = () => {
    setCategory('pothole');
    setSeverity('moderate');
    setDescription('');
    setLocation(null);
    setPhoto(null);
    setShowEditor(false);
    setShowMap(false);
    setGeoError(null);
    setConfirmedExisting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      setStatus({
        kind: 'error',
        message: intl.formatMessage({
          id: 'report.error.noLocation',
          defaultMessage: 'Please set the hazard location.',
        }),
      });
      return;
    }

    const submission: ReportSubmission = {
      category,
      severity,
      description: description.trim() || undefined,
      location,
      photo,
      clientId: newId(),
      capturedAt: Date.now(),
    };

    const parsed = reportSubmissionSchema.safeParse(submission);
    if (!parsed.success) {
      setStatus({
        kind: 'error',
        message:
          parsed.error.issues[0]?.message ??
          intl.formatMessage({ id: 'report.error.checkForm', defaultMessage: 'Please check the form.' }),
      });
      return;
    }

    setStatus({ kind: 'saving' });
    try {
      await enqueueReport(parsed.data);
      const online = isOnline();
      if (online) void syncOnce();
      setStatus({ kind: 'saved', online });
      reset();
      onSubmitted?.();
    } catch {
      setStatus({
        kind: 'error',
        message: intl.formatMessage({
          id: 'report.error.saveFailed',
          defaultMessage: 'Could not save the report on this device.',
        }),
      });
    }
  };

  if (status.kind === 'saved') {
    return (
      <div className="report-success" role="status">
        <h2>
          <FormattedMessage
            id="report.saved.heading"
            defaultMessage="{online, select, true {Report saved and syncing ✓} other {Report saved offline ✓}}"
            values={{ online: status.online }}
          />
        </h2>
        <p>
          {status.online ? (
            <FormattedMessage
              id="report.saved.online"
              defaultMessage="Thanks! It will appear on the map once a moderator approves it."
            />
          ) : (
            <FormattedMessage
              id="report.saved.offline"
              defaultMessage="You're offline — it's saved on your phone and will sync automatically when you reconnect."
            />
          )}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setStatus({ kind: 'idle' })}
        >
          <FormattedMessage id="report.saved.another" defaultMessage="Report another hazard" />
        </button>
      </div>
    );
  }

  return (
    <form
      className="report-form"
      onSubmit={handleSubmit}
      aria-label={intl.formatMessage({ id: 'report.aria', defaultMessage: 'Report a hazard' })}
    >
      <fieldset>
        <legend>
          <FormattedMessage id="report.legend.what" defaultMessage="What's the hazard?" />
        </legend>
        <label htmlFor="category">
          <FormattedMessage id="report.label.type" defaultMessage="Type" />
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as HazardCategory)}
        >
          {HAZARD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {labels.category(c)}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>
          <FormattedMessage id="report.legend.severity" defaultMessage="How dangerous is it?" />
        </legend>
        <div
          className="severity-options"
          role="radiogroup"
          aria-label={intl.formatMessage({ id: 'report.aria.severity', defaultMessage: 'Severity' })}
        >
          {SEVERITIES.map((s) => (
            <label key={s} className={`severity-chip severity-${s}`}>
              <input
                type="radio"
                name="severity"
                value={s}
                checked={severity === s}
                onChange={() => setSeverity(s)}
              />
              {labels.severity(s)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>
          <FormattedMessage id="report.legend.where" defaultMessage="Where is it?" />
        </legend>
        <div className="location-row">
          <button
            type="button"
            className="btn"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? (
              <FormattedMessage id="common.locating" defaultMessage="Locating…" />
            ) : (
              <FormattedMessage id="common.useMyLocation" defaultMessage="Use my location" />
            )}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowMap((v) => !v)}
            aria-expanded={showMap}
          >
            {showMap ? (
              <FormattedMessage id="report.map.hide" defaultMessage="Hide map" />
            ) : (
              <FormattedMessage id="report.map.set" defaultMessage="Set on map" />
            )}
          </button>
        </div>
        <p className="location-readout" aria-live="polite">
          {location ? (
            <FormattedMessage
              id="report.location.set"
              defaultMessage="Location: {coords}"
              values={{ coords: formatLatLng(location.lat, location.lng) }}
            />
          ) : (
            <FormattedMessage id="report.location.none" defaultMessage="No location set yet." />
          )}
          {location && !locationValid && (
            <span className="error-text">
              {' '}
              <FormattedMessage id="report.location.outside" defaultMessage="— outside Davis." />
            </span>
          )}
        </p>
        {geoError && (
          <p role="alert" className="error-text">
            {geoError}
          </p>
        )}
        {showMap && (
          <Suspense
            fallback={
              <p className="hint">
                <FormattedMessage id="common.loadingMap" defaultMessage="Loading map…" />
              </p>
            }
          >
            <LocationPicker value={location} onChange={setLocation} />
          </Suspense>
        )}
      </fieldset>

      <fieldset>
        <legend>
          <FormattedMessage id="report.legend.photo" defaultMessage="Photo (optional)" />
        </legend>
        {photo ? (
          <div className="photo-attached">
            <img
              src={photo}
              alt={intl.formatMessage({
                id: 'report.photo.attachedAlt',
                defaultMessage: 'Attached hazard, location data removed',
              })}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPhoto(null);
                setShowEditor(false);
              }}
            >
              <FormattedMessage id="report.photo.remove" defaultMessage="Remove photo" />
            </button>
          </div>
        ) : showEditor ? (
          <PhotoEditor
            onComplete={(dataUrl) => {
              setPhoto(dataUrl);
              setShowEditor(false);
            }}
            onCancel={() => setShowEditor(false)}
          />
        ) : (
          <button type="button" className="btn" onClick={() => setShowEditor(true)}>
            <FormattedMessage id="report.photo.add" defaultMessage="Add a photo" />
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>
          <FormattedMessage id="report.legend.notes" defaultMessage="Anything else? (optional)" />
        </legend>
        <label htmlFor="description" className="visually-hidden">
          <FormattedMessage id="report.label.description" defaultMessage="Description" />
        </label>
        <textarea
          id="description"
          value={description}
          maxLength={MAX_DESCRIPTION_LEN}
          rows={3}
          placeholder={intl.formatMessage({
            id: 'report.placeholder.description',
            defaultMessage: 'e.g. Deep pothole in the bike lane just past the light.',
          })}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="hint">
          <FormattedMessage
            id="report.charsLeft"
            defaultMessage="{count, number} characters left"
            values={{ count: MAX_DESCRIPTION_LEN - description.length }}
          />
        </p>
      </fieldset>

      {duplicates.length > 0 && !confirmedExisting && (
        <section className="dupe-nudge" aria-label="Possible duplicates nearby">
          <h2 className="dupe-nudge-title">Already reported nearby?</h2>
          <p className="hint">
            {duplicates.length === 1
              ? 'A similar hazard was'
              : `${duplicates.length} similar hazards were`}{' '}
            reported close to here. Confirming an existing report ("I saw it too")
            is more useful than filing a duplicate — it strengthens the one report
            the city sees.
          </p>
          <ul className="dupe-list">
            {duplicates.map(({ hazard, distanceMeters }) => (
              <li key={hazard.id} className="dupe-item">
                <span className="dupe-meta">
                  {CATEGORY_LABELS[hazard.category]} ·{' '}
                  {SEVERITY_LABELS[hazard.severity]} severity ·{' '}
                  {formatDistance(distanceMeters)} away · {hazard.confirmations}{' '}
                  confirmation{hazard.confirmations === 1 ? '' : 's'}
                </span>
                {onConfirmExisting && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => void confirmExisting(hazard.id)}
                  >
                    Confirm it instead
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirmedExisting && (
        <p className="dupe-confirmed" role="status">
          Thanks — we counted your "I saw it too." You don't need to file a
          duplicate. If this is a different hazard, you can still submit it below.
        </p>
      )}

      {status.kind === 'error' && (
        <p role="alert" className="error-text">
          {status.message}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={status.kind === 'saving' || !locationValid}
      >
        {status.kind === 'saving' ? (
          <FormattedMessage id="common.saving" defaultMessage="Saving…" />
        ) : (
          <FormattedMessage id="report.submit" defaultMessage="Submit report" />
        )}
      </button>
      <p className="hint">
        <FormattedMessage
          id="report.privacyNote"
          defaultMessage="Your photo's location data is removed on this device before saving, and nothing appears publicly until a moderator approves it."
        />
      </p>
    </form>
  );
}
