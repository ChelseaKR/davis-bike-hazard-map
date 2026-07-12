# Record architecture decisions

- Status: Accepted
- Date: 2026-07-11
- Deciders: Chelsea Reif

## Context

Significant decisions were previously embedded in `docs/ARCHITECTURE.md`. The
portfolio documentation standard requires an ordered, append-only MADR log so
decisions can be reviewed and superseded without rewriting history.

## Decision

Store decisions as `docs/adr/NNNN-kebab-title.md`. Every record includes Status,
Date, Deciders, Context, Decision, and Consequences. Accepted records are not
rewritten; a later record supersedes them explicitly.

## Consequences

Architecture documentation describes current reality while this directory owns
decision history. Expensive-to-reverse changes require a new ADR.
