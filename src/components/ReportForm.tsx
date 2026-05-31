/**
 * ReportForm — file a hazard in seconds, offline-first.
 *
 * Saves to the local IndexedDB queue immediately (works with no network) and
 * kicks a sync attempt when online. The photo path runs through PhotoEditor so
 * EXIF is stripped and blur is offered before anything is stored.
 */
import { Suspense, lazy, useState } from 'react';
import {
  CATEGORY_LABELS,
  HAZARD_CATEGORIES,
  SEVERITIES,
  SEVERITY_LABELS,
  type GeoPoint,
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
import { formatLatLng } from '../lib/format.ts';
import { PhotoEditor } from './PhotoEditor.tsx';

// Leaflet is heavy; only pull it in when the user opens the map picker.
const LocationPicker = lazy(() => import('./LocationPicker.tsx'));

interface ReportFormProps {
  onSubmitted?: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; online: boolean }
  | { kind: 'error'; message: string };

export function ReportForm({ onSubmitted }: ReportFormProps) {
  const [category, setCategory] = useState<HazardCategory>('pothole');
  const [severity, setSeverity] = useState<Severity>('moderate');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const locationValid = location !== null && isWithinDavis(location);

  const useMyLocation = async () => {
    setGeoError(null);
    setLocating(true);
    try {
      const point = await getCurrentLocation();
      setLocation(point);
      if (!isWithinDavis(point)) {
        setGeoError('That location is outside Davis. Adjust it on the map.');
        setShowMap(true);
      }
    } catch (err) {
      const msg =
        err instanceof GeolocationError && err.code === 'denied'
          ? 'Location permission denied. Set the spot on the map instead.'
          : 'Could not get your location. Set the spot on the map instead.';
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      setStatus({ kind: 'error', message: 'Please set the hazard location.' });
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
        message: parsed.error.issues[0]?.message ?? 'Please check the form.',
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
        message: 'Could not save the report on this device.',
      });
    }
  };

  if (status.kind === 'saved') {
    return (
      <div className="report-success" role="status">
        <h2>Report saved{status.online ? ' and syncing' : ' offline'} ✓</h2>
        <p>
          {status.online
            ? 'Thanks! It will appear on the map once a moderator approves it.'
            : "You're offline — it's saved on your phone and will sync automatically when you reconnect."}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setStatus({ kind: 'idle' })}
        >
          Report another hazard
        </button>
      </div>
    );
  }

  return (
    <form className="report-form" onSubmit={handleSubmit} aria-label="Report a hazard">
      <fieldset>
        <legend>What's the hazard?</legend>
        <label htmlFor="category">Type</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as HazardCategory)}
        >
          {HAZARD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>How dangerous is it?</legend>
        <div className="severity-options" role="radiogroup" aria-label="Severity">
          {SEVERITIES.map((s) => (
            <label key={s} className={`severity-chip severity-${s}`}>
              <input
                type="radio"
                name="severity"
                value={s}
                checked={severity === s}
                onChange={() => setSeverity(s)}
              />
              {SEVERITY_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Where is it?</legend>
        <div className="location-row">
          <button
            type="button"
            className="btn"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowMap((v) => !v)}
            aria-expanded={showMap}
          >
            {showMap ? 'Hide map' : 'Set on map'}
          </button>
        </div>
        <p className="location-readout" aria-live="polite">
          {location
            ? `Location: ${formatLatLng(location.lat, location.lng)}`
            : 'No location set yet.'}
          {location && !locationValid && (
            <span className="error-text"> — outside Davis.</span>
          )}
        </p>
        {geoError && (
          <p role="alert" className="error-text">
            {geoError}
          </p>
        )}
        {showMap && (
          <Suspense fallback={<p className="hint">Loading map…</p>}>
            <LocationPicker value={location} onChange={setLocation} />
          </Suspense>
        )}
      </fieldset>

      <fieldset>
        <legend>Photo (optional)</legend>
        {photo ? (
          <div className="photo-attached">
            <img src={photo} alt="Attached hazard photo (metadata removed)" />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPhoto(null);
                setShowEditor(false);
              }}
            >
              Remove photo
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
            Add a photo
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Anything else? (optional)</legend>
        <label htmlFor="description" className="visually-hidden">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          maxLength={MAX_DESCRIPTION_LEN}
          rows={3}
          placeholder="e.g. Deep pothole in the bike lane just past the light."
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="hint">
          {MAX_DESCRIPTION_LEN - description.length} characters left
        </p>
      </fieldset>

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
        {status.kind === 'saving' ? 'Saving…' : 'Submit report'}
      </button>
      <p className="hint">
        Your photo's location data is removed on this device before saving, and
        nothing appears publicly until a moderator approves it.
      </p>
    </form>
  );
}
