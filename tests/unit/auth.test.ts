import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword, verifyPassword } from '../../server/lib/password.ts';
import { issueToken, verifyToken, verifyBearerHeader } from '../../server/lib/token.ts';
import {
  MemoryModeratorStore,
  bootstrapModerator,
  DUMMY_PASSWORD_HASH,
} from '../../server/lib/moderators.ts';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret-pw', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different salt each time (no static hashes)', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('rejects a malformed stored hash without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe('session tokens', () => {
  const SECRET = 'unit-secret';
  const NOW = 1_700_000_000_000;

  it('round-trips a valid, unexpired token', () => {
    const tok = issueToken('alice', SECRET, 60_000, NOW);
    const payload = verifyToken(tok, SECRET, NOW + 1000);
    expect(payload?.sub).toBe('alice');
    expect(payload?.exp).toBe(NOW + 60_000);
  });

  it('rejects an expired token', () => {
    const tok = issueToken('alice', SECRET, 1000, NOW);
    expect(verifyToken(tok, SECRET, NOW + 2000)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const tok = issueToken('alice', SECRET, 60_000, NOW);
    expect(verifyToken(tok, 'other-secret', NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const tok = issueToken('alice', SECRET, 60_000, NOW);
    const [, sig] = tok.split('.');
    const forged = `${Buffer.from(JSON.stringify({ sub: 'admin', iat: NOW, exp: NOW + 60_000 })).toString('base64url')}.${sig}`;
    expect(verifyToken(forged, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyToken('garbage', SECRET, NOW)).toBeNull();
    expect(verifyToken('', SECRET, NOW)).toBeNull();
  });
});

// Header parsing and signature verification are one step on purpose. The
// caller used to do `token ? verifyToken(...) : null`, which let an
// attacker-controlled value decide whether the verification ran at all —
// CodeQL js/user-controlled-bypass (CWE-807/CWE-290, security-severity 7.8)
// flagged that line, and the fix is that no caller can reach the intermediate
// state any more. These cases all have to come out the same way: null.
describe('verifyBearerHeader', () => {
  const SECRET = 'unit-secret';
  const NOW = 1_700_000_000_000;
  const valid = () => issueToken('alice', SECRET, 60_000, NOW, 3);

  it('accepts a well-formed Bearer header and returns the payload', () => {
    const payload = verifyBearerHeader(`Bearer ${valid()}`, SECRET, NOW + 1000);
    expect(payload?.sub).toBe('alice');
    expect(payload?.ver).toBe(3);
  });

  it('returns null for an absent header rather than throwing', () => {
    expect(verifyBearerHeader(undefined, SECRET, NOW)).toBeNull();
    expect(verifyBearerHeader('', SECRET, NOW)).toBeNull();
  });

  it('returns null for a non-Bearer scheme, and does not treat the scheme as the decision', () => {
    const tok = valid();
    expect(verifyBearerHeader(`Basic ${tok}`, SECRET, NOW)).toBeNull();
    // Case-sensitive and space-sensitive: a near-miss scheme is still a deny,
    // never a pass-through of the raw header.
    expect(verifyBearerHeader(`bearer ${tok}`, SECRET, NOW)).toBeNull();
    expect(verifyBearerHeader(`Bearer${tok}`, SECRET, NOW)).toBeNull();
    expect(verifyBearerHeader(tok, SECRET, NOW)).toBeNull();
  });

  it('returns null for the right scheme with a bad, expired, or empty token', () => {
    expect(verifyBearerHeader('Bearer ', SECRET, NOW)).toBeNull();
    expect(verifyBearerHeader('Bearer garbage', SECRET, NOW)).toBeNull();
    expect(verifyBearerHeader(`Bearer ${valid()}`, 'other-secret', NOW)).toBeNull();
    expect(verifyBearerHeader(`Bearer ${issueToken('alice', SECRET, 1000, NOW)}`, SECRET, NOW + 2000)).toBeNull();
  });

  it('agrees exactly with verifyToken on the token it extracts', () => {
    const tok = valid();
    expect(verifyBearerHeader(`Bearer ${tok}`, SECRET, NOW)).toEqual(verifyToken(tok, SECRET, NOW));
  });
});

/**
 * Pin the SHAPE, not just the behaviour.
 *
 * The behaviour was already correct when CodeQL reported
 * `js/user-controlled-bypass` (security-severity 7.8, CWE-807/CWE-290) at
 * `server/app.ts` — the deny branch denied. What was wrong was the shape: an
 * attacker-controlled value decided whether the signature check ran at all.
 * The behavioural tests above would all still pass if someone reintroduced
 * that split, so this asserts the split is gone. Without it the fix is one
 * refactor away from silently coming back, and the finding with it.
 */
describe('the moderator auth path keeps its post-fix shape', () => {
  const REPO = resolve(__dirname, '../..');
  const appSrc = readFileSync(resolve(REPO, 'server/app.ts'), 'utf8');
  const tokenSrc = readFileSync(resolve(REPO, 'server/lib/token.ts'), 'utf8');

  it('app.ts verifies the header in one step and never splits it itself', () => {
    expect(appSrc).toContain('verifyBearerHeader(req.headers.authorization');
    // The exact expression CodeQL flagged, and the pieces it was built from.
    expect(appSrc).not.toContain("header.startsWith('Bearer ')");
    expect(appSrc).not.toContain('token ? verifyToken(');
    expect(appSrc).not.toMatch(/\breq\.headers\.authorization\b\s*\?\?/);
  });

  it('app.ts does not import verifyToken at all, so it cannot re-split later', () => {
    expect(appSrc).not.toMatch(/import\s*\{[^}]*\bverifyToken\b[^}]*\}\s*from\s*'\.\/lib\/token\.ts'/);
  });

  it('token.ts calls verifyToken unconditionally — the scheme picks a value, it does not gate', () => {
    const body = tokenSrc.slice(tokenSrc.indexOf('export function verifyBearerHeader'));
    expect(body).toContain('return verifyToken(token, secret, now);');
    // No early return before the verification: every header shape reaches it.
    expect(body.slice(0, body.indexOf('return verifyToken'))).not.toMatch(/\breturn\b/);
  });
});

describe('bootstrapModerator', () => {
  it('creates an account once, then is idempotent', async () => {
    const store = new MemoryModeratorStore();
    expect(await bootstrapModerator(store, 'admin', 'pw', 1)).toBe('admin');
    expect(await bootstrapModerator(store, 'admin', 'pw', 1)).toBeNull();
    expect(await store.count()).toBe(1);
    const mod = await store.findByUsername('admin');
    expect(await verifyPassword('pw', mod!.passwordHash)).toBe(true);
  });

  it('is a no-op without credentials', async () => {
    const store = new MemoryModeratorStore();
    expect(await bootstrapModerator(store, undefined, undefined, 1)).toBeNull();
    expect(await store.count()).toBe(0);
  });

  it('bumpTokenVersion increments (for session revocation) and survives re-seed', async () => {
    const store = new MemoryModeratorStore();
    await store.upsert({ username: 'a', passwordHash: 'h', createdAt: 1, tokenVersion: 0 });
    expect(await store.bumpTokenVersion('a')).toBe(1);
    expect((await store.findByUsername('a'))!.tokenVersion).toBe(1);
    // Re-seeding (bootstrap/password change) must not reset the version.
    await store.upsert({ username: 'a', passwordHash: 'h2', createdAt: 2, tokenVersion: 0 });
    expect((await store.findByUsername('a'))!.tokenVersion).toBe(1);
  });
});
