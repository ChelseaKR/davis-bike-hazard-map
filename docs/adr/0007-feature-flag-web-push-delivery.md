# Feature-flag Web Push delivery

- Status: Accepted
- Date: 2026-06-21
- Deciders: Chelsea Reif

## Context

Route/area matching and subscription storage are independently useful and
testable, but live delivery requires operational VAPID credentials.

## Decision

Ship geometric matching, durable PostgreSQL subscriptions, encrypted `web-push`,
and service-worker handlers. Gate live sends behind `PUSH_ENABLED` plus a VAPID
key pair; otherwise log dry-run matches. Prune endpoints returning 404 or 410.

## Consequences

The complete path can be tested before credentials exist, while production does
not pretend delivery is active. Subscription endpoints require retention and
redaction controls.
