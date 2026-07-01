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
import { DAVIS_CENTER } from '../../shared/validation.ts';
import { config } from '../config.ts';
import { hazardIcon } from './mapIcons.ts';
import { timeAgo } from '../lib/format.ts';
import { categoryLabel, severityLabel, lifecycleLabel, handoffLabel } from '../i18n/labels.ts';

interface MapViewProps {
  hazards: Hazard[];
  onConfirm?: (id: string) => void;
  focusHazard?: Hazard | null;
}

function buildPopup(hazard: Hazard, intl: IntlShape, onConfirm?: (id: string) => void): HTMLElement {
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

  if (hazard.handoff) {
    const handoff = document.createElement('p');
    handoff.className = 'map-popup-note';
    handoff.textContent = intl.formatMessage(
      { id: 'hazard.card.handoff', defaultMessage: 'City 311: {status}' },
      { status: handoffLabel(intl, hazard.handoff.stage) },
    );
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
    { when: timeAgo(hazard.updatedAt), count: hazard.confirmations },
  );
  el.appendChild(meta);

  const note = document.createElement('p');
  note.className = 'map-popup-note';
  note.textContent = intl.formatMessage({
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
    btn.addEventListener('click', () => onConfirm(hazard.id));
    el.appendChild(btn);
  }

  return el;
}

interface MarkerEntry {
  marker: L.Marker;
  /** Last hazard `updatedAt` rendered, to skip no-op updates. */
  updatedAt: number;
}

function makeMarker(hazard: Hazard, intl: IntlShape, onConfirm?: (id: string) => void): L.Marker {
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

function ClusterLayer({ hazards, onConfirm, intl }: MapViewProps & { intl: IntlShape }) {
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
    const nextIds = new Set(hazards.map((h) => h.id));

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
  }, [hazards, onConfirm, intl]);

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
      map.flyTo([focusHazard.location.lat, focusHazard.location.lng], 17, {
        duration: 0.6,
      });
    }
  }, [focusHazard, map]);
  return null;
}

export function MapView({ hazards, onConfirm, focusHazard }: MapViewProps) {
  const intl = useIntl();
  return (
    <div className="map-view">
      <MapContainer
        center={[DAVIS_CENTER.lat, DAVIS_CENTER.lng]}
        zoom={14}
        className="map-canvas"
        aria-label={intl.formatMessage({
          id: 'map.aria',
          defaultMessage: 'Map of reported cycling hazards in Davis',
        })}
      >
        <TileLayer attribution={config.tileAttribution} url={config.tileUrl} />
        <ClusterLayer hazards={hazards} onConfirm={onConfirm} intl={intl} />
        <FlyTo focusHazard={focusHazard} />
        <MapA11y intl={intl} />
      </MapContainer>
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
    </div>
  );
}
