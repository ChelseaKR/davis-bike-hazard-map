# Use Leaflet and raster OpenStreetMap tiles

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

The mobile PWA needs clustering, filtering, and offline-cacheable map tiles
without a paid GIS service or hosted vector-style pipeline.

## Decision

Use Leaflet, `leaflet.markercluster`, and raster OpenStreetMap tiles. Reject
MapLibre GL for v1 because its vector pipeline and weight add cost without a
required product capability.

## Consequences

The mapping stack is small and inexpensive. If vector styling becomes a real
requirement, a later ADR can replace the renderer without changing domain data.
