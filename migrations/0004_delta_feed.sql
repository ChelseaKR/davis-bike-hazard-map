-- Feature: updatedSince delta feed for the 30-second mobile poll.
-- Deletion tombstones let a delta response tell clients which hazards to drop.
-- Privacy: a tombstone is the id and a timestamp ONLY — no report content is
-- retained after a reporter deletes their record. Rows are pruned by expire()
-- once older than the delta-cursor horizon (see server/lib/repository.ts).

CREATE TABLE IF NOT EXISTS hazard_tombstones (
  id         TEXT PRIMARY KEY,
  deleted_at BIGINT NOT NULL
);

-- Delta polls filter tombstones on deleted_at and hazards on updated_at.
CREATE INDEX IF NOT EXISTS hazard_tombstones_deleted_at_idx ON hazard_tombstones (deleted_at);
CREATE INDEX IF NOT EXISTS hazards_updated_at_idx ON hazards (updated_at);
