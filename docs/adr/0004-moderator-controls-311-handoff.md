# Let moderators control 311 hand-off

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

Direct reporter submission to a municipal endpoint would amplify spam and make
the product depend on a third-party service.

## Decision

Only an authenticated moderator may forward an approved hazard. The adapter is
dry-run by default and degrades safely when no municipal integration is set.

## Consequences

The moderation boundary also protects the city endpoint. Reports remain useful
inside the map when the hand-off provider is unavailable.
