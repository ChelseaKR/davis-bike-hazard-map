# Proxy OSRM and re-rank candidate routes

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

A road graph is too large for the mobile PWA, while direct browser calls to a
router conflict with same-origin security and offline caching.

## Decision

Proxy OSRM through `/api/route`. Score candidate routes in framework-free domain
code using hazard severity, recency, confirmations, and corridor distance. Fall
back to a straight line when the router is unavailable.

## Consequences

Hazard avoidance stays testable and provider-independent. Production should
self-host OSRM before depending on service availability or throughput.
