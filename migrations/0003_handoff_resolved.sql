-- Feature: resolved-hazard lifecycle + 311 status sync-back.
-- Adds a resolution timestamp (so recently-fixed hazards can linger, greyed, on
-- the public map) and a JSONB hand-off record carrying the synced-back 311 state.

ALTER TABLE hazards ADD COLUMN IF NOT EXISTS resolved_at BIGINT;
ALTER TABLE hazards ADD COLUMN IF NOT EXISTS handoff JSONB;

-- Surfacing recently-resolved hazards filters on (status, resolved_at).
CREATE INDEX IF NOT EXISTS hazards_resolved_idx ON hazards (status, resolved_at);
