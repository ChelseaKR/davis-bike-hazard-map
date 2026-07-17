-- FIX-04: keyset pagination of the moderation queue.
-- Partial index over the pending backlog in exactly the page order
-- listPending() reads: (created_at, id COLLATE "C"), oldest first.
CREATE INDEX IF NOT EXISTS hazards_pending_page_idx
  ON hazards (created_at, id COLLATE "C")
  WHERE status = 'pending';
