-- Feature: durable Web Push subscriptions for saved-route/area alerts.
-- Mirrors the in-memory store shape (server/lib/subscriptions.ts): the id is a
-- hash of the endpoint so re-subscribing replaces rather than duplicates, the
-- watch (area bbox or route corridor) is JSONB, and created_at/expires_at are
-- epoch millis (BIGINT) like every other timestamp in this schema. expires_at
-- carries the FIX-10 180-day TTL: prune() deletes rows past it, and
-- re-subscribing upserts a fresh one (renewal).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  watch      JSONB NOT NULL,
  label      TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
