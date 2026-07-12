# Require manual photo blur as the privacy floor

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

Hazard photos may contain faces or license plates. Automatic detection can miss
identifiers and adds model weight to the offline mobile path.

## Decision

Always provide offline manual region blur. Treat the browser `FaceDetector` API
only as progressive enhancement that proposes regions; never make privacy depend
on its availability or accuracy.

## Consequences

Users retain a reliable privacy control offline. Automatic assistance may reduce
effort but cannot silently bypass manual review.
