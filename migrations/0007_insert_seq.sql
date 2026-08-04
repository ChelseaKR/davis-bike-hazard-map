-- Deterministic tiebreak for "newest first" listings. resolved_at (and
-- updated_at) are millisecond epoch values supplied by the app, so two
-- writes in the same millisecond tie on ORDER BY ... DESC and Postgres does
-- not guarantee which comes first for ties (unlike the in-memory store's
-- stable sort, which preserves insertion order). insert_seq is a monotonic
-- per-row counter that lets listRecentlyResolved break ties the same way the
-- in-memory JSON store already does: earlier insert first.
ALTER TABLE hazards ADD COLUMN IF NOT EXISTS insert_seq BIGSERIAL;
