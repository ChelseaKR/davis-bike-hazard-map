# Moderation policy — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §A/§F for this repo.

## Principle

Nothing user-submitted is public until a human approves it. There is **no
unmoderated public photo feed** — this is a launch gate, not a nice-to-have.

## Flow

1. A report arrives as `pending`. It is invisible on the map/list, and its photo
   is not servable to the public (`GET /api/photos/:id` 404s until approved).
2. A moderator authenticates with a bearer token and reviews the queue
   (`GET /api/moderation/queue`). The photo is inlined in that auth-gated
   response so it can be judged; it is never exposed publicly while pending.
3. The moderator **approves** (becomes public, fuzzed), **rejects** (never
   public), or later **resolves** (cleared from the map).
4. The map self-cleans: approved hazards expire after a severity-based TTL.

## What gets rejected

- Photos of identifiable people or licence plates that weren't blurred.
- Content that is not a cycling hazard, is abusive, or targets individuals.
- Obvious spam or out-of-area (outside the Davis bounding box — also rejected at
  intake by validation).

## SLA

- Target first-review of a pending report: **within 48 hours**. Queue depth is
  the operational signal to watch (see README → Operations).

## Misuse resistance (mechanical)

- Out-of-Davis coordinates are rejected at intake (`davisPointSchema`).
- Submission is rate-limited (per-IP, per-hour) to blunt spam.
- Idempotent submission (client UUID) prevents retry-duplication.
- 311 hand-off is moderator-only (least privilege), never reporter-triggered.

## Checklist

- [x] No public exposure before approval — **auto-gated** (server tests:
  "keeps it out of the public feed until approved", photo gating).
- [x] Moderation endpoints require auth — **auto-gated** (server auth tests).
- [x] Out-of-area / spam resistance — **auto-gated** (validation + rate-limit).
- [ ] Moderation guidelines + reviewer roster — **review-gated** (operational sign-off pre-launch).

**Last verified: 2026-05-31 · Recheck cadence: per launch / policy change.**
