-- Session revocation: a per-moderator token version. Bumping it invalidates
-- every previously issued session for that moderator (sign-out-everywhere /
-- compromised-token response) without server-side session storage.
ALTER TABLE moderators ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
