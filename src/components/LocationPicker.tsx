/**
 * A small tap-to-place map for choosing a hazard's location.
 *
 * Uses OpenStreetMap tiles only (cost guardrail). It is a progressive nicety —
 * the report form also supports geolocation and manual entry — so it is loaded
 * lazily and never blocks the form on mobile data.
 */
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import { useIntl } from 'react-intl';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint } from '../../shared/types.ts';
import { DAVIS_CENTER } from '../../shared/validation.ts';
import { config } from '../config.ts';
import { hazardIcon } from './mapIcons.ts';

interface LocationPickerProps {
  value: GeoPoint | null;
  onChange: (point: GeoPoint) => void;
}

function ClickToPlace({ onChange }: { onChange: (p: GeoPoint) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationPicker({ value, onChange }: LocationPickerProps) {
  const intl = useIntl();
  const center = value ?? DAVIS_CENTER;
  return (
    <div className="location-picker">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={15}
        scrollWheelZoom={false}
        className="location-picker-map"
        aria-label={intl.formatMessage({
          id: 'locationPicker.aria',
          defaultMessage: 'Tap the map to set the hazard location',
        })}
      >
        <TileLayer attribution={config.tileAttribution} url={config.tileUrl} />
        <ClickToPlace onChange={onChange} />
        {value && (
          <Marker
            position={[value.lat, value.lng]}
            icon={hazardIcon('moderate')}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const m = e.target as L.Marker;
                const p = m.getLatLng();
                onChange({ lat: p.lat, lng: p.lng });
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
