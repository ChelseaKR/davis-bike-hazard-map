-- Baseline schema: hazards (+ indexes) and moderator accounts.
-- IF NOT EXISTS keeps this safe to apply on a DB that predates migrations
-- (the previous CREATE TABLE-on-boot path) — it just records the baseline.

CREATE TABLE IF NOT EXISTS hazards (
  id            TEXT PRIMARY KEY,
  client_id     TEXT UNIQUE NOT NULL,
  category      TEXT NOT NULL,
  severity      TEXT NOT NULL,
  description   TEXT,
  precise_lat   DOUBLE PRECISION NOT NULL,
  precise_lng   DOUBLE PRECISION NOT NULL,
  public_lat    DOUBLE PRECISION NOT NULL,
  public_lng    DOUBLE PRECISION NOT NULL,
  photo_mime    TEXT,
  status        TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL,
  moderation    JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS hazards_active_idx ON hazards (status, expires_at);
CREATE INDEX IF NOT EXISTS hazards_bbox_idx ON hazards (public_lat, public_lng);

CREATE TABLE IF NOT EXISTS moderators (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);
