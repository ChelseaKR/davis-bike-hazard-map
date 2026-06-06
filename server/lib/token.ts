/**
 * Minimal signed session tokens (a compact JWT-style HS256 token).
 *
 * A token is `base64url(payload).base64url(hmacSHA256(payload))`. The payload
 * carries the subject (moderator username) and an expiry. Verification is
 * constant-time and checks expiry. We sign with a server secret and keep this
 * deliberately tiny — it is a first-party moderator session, not a federation
 * protocol — so there is no third-party auth library to audit.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  /** Subject: the moderator's username. */
  sub: string;
  /** Token version at issue time — compared to the account's current version
   *  for revocation (a bump invalidates older sessions). */
  ver: number;
  /** Issued-at (epoch ms). */
  iat: number;
  /** Expiry (epoch ms). */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

/** Issue a signed session token for `username` at token version `ver`. */
export function issueToken(
  username: string,
  secret: string,
  ttlMs: number,
  now: number,
  ver = 0,
): string {
  const payload: SessionPayload = { sub: username, ver, iat: now, exp: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body, secret)}`;
}

/** Verify a token: returns the payload if the signature is valid and unexpired. */
export function verifyToken(token: string, secret: string, now: number): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}
