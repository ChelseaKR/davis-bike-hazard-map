# CLAUDE.md — Davis Bike Hazard Map

Agent contract for this repo. Per DOCUMENTATION-STANDARD §7/§9, agent-facing
instructions live here, not in the README (moved from the README's former
"For Claude Code" section, 2026-07-19).

- **Build entrypoint:** [`docs/ROADMAP.md`](./docs/ROADMAP.md) → *Implementation Plan*; what was built is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- **Hard guardrails:** **strip EXIF and offer face/plate blurring on every photo before upload** (privacy is a gate); the map must be usable on mobile data and offline; moderation exists before launch (no unmoderated public photo feed); GIS stays free via OpenStreetMap; accessibility is a gate (the map has a non-map list view).
- **Commands:** `make dev` · `make verify` · `make a11y` · `make e2e`.
- **Definition of done:** a Davis cyclist can install the PWA, file a hazard offline, see it on the map after sync, and (optionally) push it to 311 — functionally met; see the README's "Testing & gates" table and [`docs/audits/`](./docs/audits/). Standards conformance: see the README's "Standards Conformance" table — gaps are tracked, not hidden.
