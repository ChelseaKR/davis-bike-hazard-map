import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../server/lib/password.ts';
import { issueToken, verifyToken } from '../../server/lib/token.ts';
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
});
