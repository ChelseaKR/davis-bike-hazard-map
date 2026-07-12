# Allow a deploy-only Fly.io token

- Status: Accepted
- Date: 2026-07-05
- Deciders: Chelsea Reif

## Context

Fly.io does not expose a GitHub OIDC trust path equivalent to AWS role
assumption, but the alternative deployment workflow needs authentication.

## Decision

When Fly deployment is used, store only an app-scoped deploy token in the
`FLY_API_TOKEN` repository secret, consume it solely in the production deploy
job, and rotate it every 90 days or immediately after suspected exposure.

## Consequences

This is a documented exception to the OIDC preference. Least privilege,
environment review, secret scanning, and rotation are compensating controls.
