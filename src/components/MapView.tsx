/**
 * The clustered OpenStreetMap view of live hazards.
 *
 * Clustering is done with leaflet.markercluster (imperatively, via useMap) so
 * the map stays light on mobile data. Everything shown here is also available
 * in ListView — the map is never the only way to the data (a11y gate).
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type Hazard,
} from '../../shared/types.ts';
import { DAVIS_CENTER } from '../../shared/validation.ts';
import { config } from '../config.ts';
import { hazardIcon } from './mapIcons.ts';
import { timeAgo } from '../lib/format.ts';

interface MapViewProps {
  hazards: Hazard[];
  onConfirm?: (id: string) => void;
  focusHazard?: Hazard | null;
}

function buildPopup(hazard: Hazard, onConfirm?: (id: string) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-popup';

  const title = document.createElement('h3');
  title.textContent = `${CATEGORY_LABELS[hazard.category]} · ${SEVERITY_LABELS[hazard.severity]}`;
  el.appendChild(title);

  if (hazard.description) {
    const desc = document.createElement('p');
    desc.textContent = hazard.description;
    el.appendChild(desc);
  }

  if (hazard.photoUrl) {
    const img = document.createElement('img');
    img.src = hazard.photoUrl;
    img.alt = `Reported ${CATEGORY_LABELS[hazard.category].toLowerCase()}`;
    img.className = 'map-popup-photo';
    img.loading = 'lazy';
    // Degrade to a caption if the photo fails to load (e.g. 404 after expiry).
    img.addEventListener('error', () => {
      const fallback = document.createElement('p');
      fallback.className = 'map-popup-note';
      fallback.textContent = 'Photo unavailable';
      img.replaceWith(fallback);
    });
    el.appendChild(img);
  }

  const meta = document.createElement('p');
  meta.className = 'map-popup-meta';
  meta.textContent = `Reported ${timeAgo(hazard.updatedAt)} · ${hazard.confirmations} confirmation${hazard.confirmations === 1 ? '' : 's'}`;
  el.appendChild(meta);

  const note = document.createElement('p');
  note.className = 'map-popup-note';
  note.textContent = 'Community-reported — not verified by the city.';
  el.appendChild(note);

  if (onConfirm) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small';
    btn.textContent = 'I saw this too';
    btn.addEventListener('click', () => onConfirm(hazard.id));
    el.appendChild(btn);
  }

  return el;
}

function ClusterLayer({ hazards, onConfirm }: MapViewProps) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const hazard of hazards) {
      const marker = L.marker([hazard.location.lat, hazard.location.lng], {
        icon: hazardIcon(hazard.severity),
        keyboard: true,
        title: `${CATEGORY_LABELS[hazard.category]}, ${SEVERITY_LABELS[hazard.severity]} severity`,
        alt: `${CATEGORY_LABELS[hazard.category]} hazard marker`,
      });
      marker.bindPopup(() => buildPopup(hazard, onConfirm));
      group.addLayer(marker);
    }
  }, [hazards, onConfirm]);

  return null;
}

/**
 * Patch the accessibility of Leaflet's injected controls (an upstream gap):
 * give the zoom buttons accessible names and wrap the control cluster in a
 * labelled region so the whole map view is axe-clean.
 */
function MapA11y() {
  const map = useMap();
  useEffect(() => {
    const root = map.getContainer();
    root.querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', 'Zoom in');
    root.querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', 'Zoom out');
    const controls = root.querySelector('.leaflet-control-container');
    if (controls) {
      controls.setAttribute('role', 'region');
      controls.setAttribute('aria-label', 'Map controls');
    }
  }, [map]);
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
  return (
    <div className="map-view">
      <MapContainer
        center={[DAVIS_CENTER.lat, DAVIS_CENTER.lng]}
        zoom={14}
        className="map-canvas"
        aria-label="Map of reported cycling hazards in Davis"
      >
        <TileLayer attribution={config.tileAttribution} url={config.tileUrl} />
        <ClusterLayer hazards={hazards} onConfirm={onConfirm} />
        <FlyTo focusHazard={focusHazard} />
        <MapA11y />
      </MapContainer>
      <p className="map-caption hint">
        Markers show <strong>reported</strong> hazards. Empty areas mean no
        reports, not guaranteed safety. Prefer the{' '}
        <a href="#list-panel">list view</a> if the map is hard to use.
      </p>
    </div>
  );
}
