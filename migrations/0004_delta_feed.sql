-- Feature: updatedSince delta feed for the 30s mobile poll.
-- A tombstone table records id-only removals (no content, per the privacy note)
-- so a delta poll can convey deletions, not just changes. The updated_at index
-- backs the "changed since cursor" scan.

CREATE TABLE IF NOT EXISTS hazard_tombstones (
  id         TEXT PRIMARY KEY,
  deleted_at BIGINT NOT NULL
);

-- Prune scans + tombstone-since-cursor lookups filter on deleted_at.
CREATE INDEX IF NOT EXISTS hazard_tombstones_deleted_idx ON hazard_tombstones (deleted_at);

-- The delta feed scans approved rows by updated_at.
CREATE INDEX IF NOT EXISTS hazards_updated_idx ON hazards (updated_at);
