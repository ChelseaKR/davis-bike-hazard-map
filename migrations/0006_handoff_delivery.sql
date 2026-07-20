-- R3: 311 hand-off delivery receipts + reconciliation/retry.
-- One JSONB receipt per hazard (state/attempts/nextRetryAt/lastError —
-- see server/lib/types.ts HandoffDelivery). The partial index serves the two
-- receipt reads: retry-due sweeps and the moderator dead-letter list.
ALTER TABLE hazards ADD COLUMN IF NOT EXISTS handoff_delivery JSONB;

CREATE INDEX IF NOT EXISTS hazards_handoff_delivery_state_idx
  ON hazards ((handoff_delivery->>'state'))
  WHERE handoff_delivery IS NOT NULL;
