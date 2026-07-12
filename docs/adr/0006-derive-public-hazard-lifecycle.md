# Derive the public hazard lifecycle

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

The public needs understandable reported, confirmed, and resolved states without
a second mutable state machine that can diverge from moderation.

## Decision

Derive public lifecycle from moderation status and confirmations. Keep recently
resolved hazards visible briefly, and accept 311 status updates only through an
authenticated, disabled-by-default webhook.

## Consequences

Existing moderation invariants remain authoritative, fixes are visible, and an
unauthenticated provider cannot mutate hazard state.
