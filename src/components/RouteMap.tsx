/**
 * Map rendering for a planned route: the route polyline plus markers for the
 * start, end, and any hazards still on/near the chosen route.
 *
 * This is a progressive enhancement only — the RoutePlanner's turn-by-turn
 * <ol> is the accessible source of truth (map/list parity). Like MapView it is
 * imperative Leaflet glue that needs a real browser DOM, so it is lazy-loaded
 * and covered by the Playwright + axe e2e pass rather than jsdom unit tests.
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_LABELS, SEVERITY_LABELS, type GeoPoint } from '../../shared/types.ts';
import type { NearbyHazard, Route } from '../../shared/routing.ts';
import { DAVIS_CENTER } from '../../shared/validation.ts';
import { config } from '../config.ts';
import { hazardIcon } from './mapIcons.ts';

interface RouteMapProps {
  route: Route;
  from: GeoPoint;
  to: GeoPoint;
  nearby: NearbyHazard[];
}

function endpointIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'route-endpoint-icon',
    html: `<span style="background:${color}" aria-hidden="true">${label}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function RouteLayer({ route, from, to, nearby }: RouteMapProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    layerRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();

    const latlngs = route.geometry.map((p) => [p.lat, p.lng] as [number, number]);
    const line = L.polyline(latlngs, { color: '#0b6e4f', weight: 5, opacity: 0.85 });
    group.addLayer(line);

    L.marker([from.lat, from.lng], { icon: endpointIcon('A', '#0b6e4f'), title: 'Start' }).addTo(group);
    L.marker([to.lat, to.lng], { icon: endpointIcon('B', '#1f2937'), title: 'Destination' }).addTo(group);

    for (const n of nearby) {
      L.marker([n.hazard.location.lat, n.hazard.location.lng], {
        icon: hazardIcon(n.hazard.severity),
        title: `${CATEGORY_LABELS[n.hazard.category]} (${SEVERITY_LABELS[n.hazard.severity]}) on route`,
      }).addTo(group);
    }

    if (latlngs.length) {
      map.fitBounds(line.getBounds().pad(0.2), { animate: false });
    }
  }, [map, route, from, to, nearby]);

  return null;
}

export function RouteMap(props: RouteMapProps) {
  return (
    <div className="route-map">
      <MapContainer
        center={[DAVIS_CENTER.lat, DAVIS_CENTER.lng]}
        zoom={14}
        className="map-canvas"
        aria-label="Map of the planned cycling route"
      >
        <TileLayer attribution={config.tileAttribution} url={config.tileUrl} />
        <RouteLayer {...props} />
      </MapContainer>
    </div>
  );
}
