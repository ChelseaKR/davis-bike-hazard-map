/**
 * Leaflet marker icons keyed by severity, built as inline SVG data URLs so we
 * ship no binary marker assets and stay fully offline-capable.
 */
import L from 'leaflet';
import type { Severity } from '../../shared/types.ts';

const SEVERITY_COLORS: Record<Severity, string> = {
  low: '#e0a106',
  moderate: '#e8590c',
  high: '#c92a2a',
};

function pinSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 26 14 26s14-16.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}"/>
    <circle cx="14" cy="14" r="6" fill="#fff"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const iconCache = new Map<Severity, L.Icon>();

export function hazardIcon(severity: Severity): L.Icon {
  const cached = iconCache.get(severity);
  if (cached) return cached;
  const icon = L.icon({
    iconUrl: pinSvg(SEVERITY_COLORS[severity]),
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  });
  iconCache.set(severity, icon);
  return icon;
}

export { SEVERITY_COLORS };
