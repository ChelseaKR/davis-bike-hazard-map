/**
 * The clustered OpenStreetMap view of live hazards.
 *
 * Clustering is done with leaflet.markercluster (imperatively, via useMap) so
 * the map stays light on mobile data. Everything shown here is also available
 * in ListView — the map is never the only way to the data (a11y gate).
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { lifecycleStage, type Hazard } from '../../shared/types.ts';
import { PLACE_CENTER } from '../../shared/validation.ts';
import { config } from '../config.ts';
import { hazardIcon } from './mapIcons.ts';
import { timeAgo } from '../lib/format.ts';
import { categoryLabel, severityLabel, lifecycleLabel, handoffNote } from '../i18n/labels.ts';

interface MapViewProps {
  hazards: Hazard[];
  onConfirm?: (id: string) => void | Promise<boolean | void>;
  focusHazard?: Hazard | null;
  /**
   * The feed's last load error, or null. The map MUST be told: without it an
   * empty map after a failed fetch is indistinguishable from an empty map
   * after a successful one, and the caption below asserts the second.
   */
  feedError?: string | null;
  onRetry?: () => void;
}

/**
 * Build the popup DOM for a hazard marker. Exported (not just used
 * internally) so a unit test can assert the 'Demo data' marker appears for
 * seeded hazards and NOT for real ones (issue #111) without a full Leaflet/
 * jsdom map render.
 */
export function buildPopup(
  hazard: Hazard,
  intl: IntlShape,
  onConfirm?: (id: string) => void | Promise<boolean | void>,
  // Leaflet calls the `bindPopup` content function every time the popup opens
  // (see makeMarker), so the default reads the clock at open time and the line
  // is correct each time a rider taps a marker. It does not tick while the
  // popup is open, and deliberately so: the alternative is rebuilding the
  // clustered marker layer once a minute. Named rather than implicit so the
  // clock is visible and pinnable, per src/lib/useNow.ts.
  now: number = Date.now(),
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-popup';

  const title = document.createElement('h3');
  title.textContent = `${categoryLabel(intl, hazard.category)} · ${severityLabel(intl, hazard.severity)}`;
  el.appendChild(title);

  const stage = lifecycleStage(hazard);
  const badge = document.createElement('p');
  badge.className = `map-popup-stage lifecycle-${stage}`;
  badge.textContent = lifecycleLabel(intl, stage);
  el.appendChild(badge);

  if (hazard.source === 'seed') {
    const demo = document.createElement('p');
    demo.className = 'map-popup-demo';
    demo.textContent = intl.formatMessage({
      id: 'hazard.card.demoBadge',
      defaultMessage: 'Demo data',
    });
    el.appendChild(demo);
  }

  if (hazard.handoff) {
    const handoff = document.createElement('p');
    handoff.className = `map-popup-note hazard-handoff-${hazard.handoff.delivery}`;
    // Same string as the list card (issue #162): a dry-run or a failed transport
    // must not read here as a completed submission either.
    handoff.textContent = handoffNote(intl, hazard.handoff);
    el.appendChild(handoff);
  }

  if (hazard.description) {
    const desc = document.createElement('p');
    desc.textContent = hazard.description;
    el.appendChild(desc);
  }

  if (hazard.photoUrl) {
    const img = document.createElement('img');
    img.src = hazard.thumbnailUrl ?? hazard.photoUrl;
    img.alt = intl.formatMessage(
      { id: 'map.popup.photoAlt', defaultMessage: 'Reported {category}' },
      { category: categoryLabel(intl, hazard.category).toLowerCase() },
    );
    img.className = 'map-popup-photo';
    img.loading = 'lazy';
    // Degrade to a caption if the photo fails to load (e.g. 404 after expiry).
    img.addEventListener('error', () => {
      const fallback = document.createElement('p');
      fallback.className = 'map-popup-note';
      fallback.textContent = intl.formatMessage({
        id: 'photo.unavailable',
        defaultMessage: 'Photo unavailable',
      });
      img.replaceWith(fallback);
    });
    el.appendChild(img);
  }

  const meta = document.createElement('p');
  meta.className = 'map-popup-meta';
  meta.textContent = intl.formatMessage(
    {
      id: 'map.popup.meta',
      defaultMessage:
        'Reported {when} · {count, plural, one {# confirmation} other {# confirmations}}',
    },
    { when: timeAgo(hazard.updatedAt, now), count: hazard.confirmations },
  );
  el.appendChild(meta);

  const note = document.createElement('p');
  note.className = 'map-popup-note';
  note.textContent =
    hazard.source === 'seed'
      ? intl.formatMessage({
          id: 'hazard.card.demoNote',
          defaultMessage: 'Demo data — a fictional example, not a real report.',
        })
      : intl.formatMessage({
          id: 'hazard.card.note',
          defaultMessage: 'Community-reported — not verified by the city.',
        });
  el.appendChild(note);

  if (onConfirm && stage !== 'resolved' && stage !== 'expired') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small';
    btn.textContent = intl.formatMessage({
      id: 'hazard.card.confirm',
      defaultMessage: 'I saw this too',
    });
    btn.addEventListener('click', () => {
      void (async () => {
        const counted = await onConfirm(hazard.id);
        // `undefined` means the caller reported no outcome (a network error, or
        // a test double that returns nothing). Say nothing rather than inventing
        // a result — but leave the button in place so a retry is possible.
        if (counted === undefined) return;
        // Replace the button, rather than adding beside it. Confirmations count
        // once per device per window (#177), so leaving a live button under
        // "already counted" is an invitation to press a control that cannot do
        // anything — which is how a rider concludes the app is broken.
        const note = document.createElement('p');
        note.className = 'hazard-confirm-note';
        note.setAttribute('role', 'status');
        note.textContent = counted
          ? intl.formatMessage({
              id: 'hazard.card.confirmCounted',
              defaultMessage: 'Thanks — your confirmation was counted.',
            })
          : intl.formatMessage({
              id: 'hazard.card.confirmAlready',
              defaultMessage:
                'You already confirmed this one, so the count stays where it is. Confirmations are counted once per device so the number means riders, not taps.',
            });
        btn.replaceWith(note);
      })();
    });
    el.appendChild(btn);
  }

  return el;
}

interface MarkerEntry {
  marker: L.Marker;
  /** Last hazard `updatedAt` rendered, to skip no-op updates. */
  updatedAt: number;
}

function makeMarker(
  hazard: Hazard,
  intl: IntlShape,
  onConfirm?: (id: string) => void | Promise<boolean | void>,
): L.Marker {
  const marker = L.marker([hazard.location.lat, hazard.location.lng], {
    icon: hazardIcon(hazard.severity),
    keyboard: true,
    title: intl.formatMessage(
      { id: 'map.marker.title', defaultMessage: '{category}, {severity} severity' },
      { category: categoryLabel(intl, hazard.category), severity: severityLabel(intl, hazard.severity) },
    ),
    alt: intl.formatMessage(
      { id: 'map.marker.alt', defaultMessage: '{category} hazard marker' },
      { category: categoryLabel(intl, hazard.category) },
    ),
  });
  marker.bindPopup(() => buildPopup(hazard, intl, onConfirm));
  return marker;
}

function ClusterLayer({ hazards, onConfirm, focusHazard, intl }: MapViewProps & { intl: IntlShape }) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());

  useEffect(() => {
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
    });
    groupRef.current = group;
    map.addLayer(group);
    const markers = markersRef.current;
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
      markers.clear();
    };
  }, [map]);

  // Reconcile markers against the latest hazards by id instead of clearing and
  // re-adding everything — re-clustering the whole set on each refresh is the
  // expensive part, and most markers are unchanged between refreshes.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const entries = markersRef.current;
    // The permalink target is rendered by FocusMarker so it can never be
    // hidden inside an asynchronously populated cluster.
    const nextIds = new Set(hazards.filter((h) => h.id !== focusHazard?.id).map((h) => h.id));

    // Remove markers for hazards that are gone.
    for (const [id, entry] of entries) {
      if (!nextIds.has(id)) {
        group.removeLayer(entry.marker);
        entries.delete(id);
      }
    }

    // Add new markers; update in place only when the hazard actually changed.
    const toAdd: L.Marker[] = [];
    for (const hazard of hazards) {
      if (hazard.id === focusHazard?.id) continue;
      const existing = entries.get(hazard.id);
      if (!existing) {
        const marker = makeMarker(hazard, intl, onConfirm);
        entries.set(hazard.id, { marker, updatedAt: hazard.updatedAt });
        toAdd.push(marker);
      } else if (existing.updatedAt !== hazard.updatedAt) {
        existing.marker.setLatLng([hazard.location.lat, hazard.location.lng]);
        existing.marker.setIcon(hazardIcon(hazard.severity));
        existing.marker.bindPopup(() => buildPopup(hazard, intl, onConfirm));
        existing.updatedAt = hazard.updatedAt;
      }
    }
    if (toAdd.length) group.addLayers(toAdd);
  }, [hazards, onConfirm, focusHazard, intl]);

  return null;
}

/** Keep a permalink target visible independently of marker-cluster timing. */
function FocusMarker({
  hazard,
  onConfirm,
  intl,
}: {
  hazard?: Hazard | null;
  onConfirm?: (id: string) => void | Promise<boolean | void>;
  intl: IntlShape;
}) {
  const map = useMap();
  useEffect(() => {
    if (!hazard) return;
    const marker = makeMarker(hazard, intl, onConfirm).addTo(map);
    return () => {
      map.removeLayer(marker);
    };
  }, [hazard, onConfirm, intl, map]);
  return null;
}

/**
 * Patch the accessibility of Leaflet's injected controls (an upstream gap):
 * give the zoom buttons accessible names and wrap the control cluster in a
 * labelled region so the whole map view is axe-clean.
 */
function MapA11y({ intl }: { intl: IntlShape }) {
  const map = useMap();
  useEffect(() => {
    const root = map.getContainer();
    root
      .querySelector('.leaflet-control-zoom-in')
      ?.setAttribute('aria-label', intl.formatMessage({ id: 'map.zoomIn', defaultMessage: 'Zoom in' }));
    root
      .querySelector('.leaflet-control-zoom-out')
      ?.setAttribute('aria-label', intl.formatMessage({ id: 'map.zoomOut', defaultMessage: 'Zoom out' }));
    const controls = root.querySelector('.leaflet-control-container');
    if (controls) {
      controls.setAttribute('role', 'region');
      controls.setAttribute(
        'aria-label',
        intl.formatMessage({ id: 'map.controls', defaultMessage: 'Map controls' }),
      );
    }
  }, [map, intl]);
  return null;
}

function FlyTo({ focusHazard }: { focusHazard?: Hazard | null }) {
  const map = useMap();
  useEffect(() => {
    if (focusHazard) {
      // A deep link is navigation state, not a decorative transition. An
      // immediate view update makes marker-cluster reconciliation deterministic
      // on cold Firefox loads; the previous animated flyTo could race the lazy
      // map chunk and leave the focused marker represented only by a cluster.
      map.setView([focusHazard.location.lat, focusHazard.location.lng], 17, {
        animate: false,
      });
    }
  }, [focusHazard, map]);
  return null;
}

/**
 * Everything the map says about its own data, in one place — and, crucially,
 * outside `<MapContainer>` so it is plain DOM that a unit test can render
 * without Leaflet (same reason `buildPopup` is exported).
 *
 * The caption exists because an empty patch of map reads as "safe here". It
 * says the opposite: empty means *unreported*. But that sentence is only true
 * when the feed actually loaded. When the fetch failed, the map is empty (or
 * stale) because the DATA did not arrive, and repeating "empty areas mean no
 * reports" would publish a failed read as a measurement — the same class of
 * defect `CoverageView` and `ListView` already guard against, in the one
 * surface a rider is most likely to act on.
 *
 * So on a feed error the caption is replaced, not merely accompanied: the
 * "no reports" claim is withdrawn, the failure is announced (`role="alert"`,
 * matching ListView's), and the rider is given the same retry the list has.
 */
export function MapDataNotice({
  feedError,
  onRetry,
}: {
  feedError: string | null;
  onRetry?: () => void;
}) {
  if (feedError) {
    return (
      <div role="alert" className="feed-error map-feed-error">
        <p className="error-text">
          <FormattedMessage
            id="map.feedError"
            defaultMessage="<strong>The hazard feed could not be loaded</strong>, so this map is incomplete or out of date. An empty map right now means the data did not arrive — <strong>not</strong> that nothing has been reported."
            values={{ strong: (chunks) => <strong>{chunks}</strong> }}
          />
        </p>
        <p className="error-text error-detail">{feedError}</p>
        {onRetry && (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            <FormattedMessage id="common.retry" defaultMessage="Retry" />
          </button>
        )}
      </div>
    );
  }
  return (
    <p className="map-caption hint">
      <FormattedMessage
        id="map.caption"
        defaultMessage="Markers show <strong>reported</strong> hazards. Empty areas mean no reports, not guaranteed safety. Prefer the <link>list view</link> if the map is hard to use."
        values={{
          strong: (chunks) => <strong>{chunks}</strong>,
          link: (chunks) => <a href="#list-panel">{chunks}</a>,
        }}
      />
    </p>
  );
}

export function MapView({ hazards, onConfirm, focusHazard, feedError = null, onRetry }: MapViewProps) {
  const intl = useIntl();
  return (
    <div className="map-view">
      <MapContainer
        center={[PLACE_CENTER.lat, PLACE_CENTER.lng]}
        zoom={14}
        className="map-canvas"
        aria-label={intl.formatMessage({
          id: 'map.aria',
          defaultMessage: 'Map of reported cycling hazards in Davis',
        })}
      >
        <TileLayer attribution={config.tileAttribution} url={config.tileUrl} />
        <ClusterLayer
          hazards={hazards}
          onConfirm={onConfirm}
          focusHazard={focusHazard}
          intl={intl}
        />
        <FocusMarker hazard={focusHazard} onConfirm={onConfirm} intl={intl} />
        <FlyTo focusHazard={focusHazard} />
        <MapA11y intl={intl} />
      </MapContainer>
      <MapDataNotice feedError={feedError} onRetry={onRetry} />
    </div>
  );
}
