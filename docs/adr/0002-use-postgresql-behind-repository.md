# Use PostgreSQL behind an asynchronous repository interface

- Status: Accepted
- Date: 2026-05-31
- Deciders: Chelsea Reif

## Context

Production needs multi-process-safe persistence, indexed reads, managed backups,
and bounding-box filtering; local development should remain zero-dependency.

## Decision

Select PostgreSQL when `DATABASE_URL` is set, a single-process atomic JSON store
when `DATABASE_PATH` is set, and memory otherwise, all behind one asynchronous
`Repository` interface. Use plain PostgreSQL rather than PostGIS while bounding
boxes are the only spatial database query.

## Consequences

Production can scale independently of the development fallback. PostGIS remains
an additive future choice behind the same interface.
