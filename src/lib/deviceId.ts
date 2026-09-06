/**
 * A device-scoped identifier, used only so the server can tell "the same phone
 * tapped confirm twice" from "two riders saw the same hazard" (#177).
 *
 * ## Why this is not a report's `clientId`
 *
 * `clientId` is minted fresh per submission (`ReportForm`), which is exactly
 * right for its job — it is the reporter's delete capability for one report. It
 * identifies nothing across two confirmations, so it cannot carry a per-device
 * cap.
 *
 * ## What it is, and what it is not
 *
 * A random UUID kept in `localStorage`. It is **not** an account, not a login,
 * and not a fingerprint: nothing derives it from the device, so it cannot be
 * recomputed after it is cleared, and clearing site data really does end it.
 *
 * The server never stores it. It is folded into a rotating salted HMAC bound to
 * one hazard, and only that opaque token is held, in memory, for a window — see
 * `server/lib/confirmationCap.ts`. So the server cannot ask "what has this device
 * confirmed?", which matters on a map whose whole privacy posture is about not
 * accumulating a cyclist's movements.
 *
 * ## Storage failures
 *
 * A private window, disabled site data, or a quota error make `localStorage`
 * throw or come back empty. That is handled by minting an ephemeral id for the
 * session rather than by sending nothing: sending nothing would be a 400, so a
 * rider in a private window could not confirm anything at all. An ephemeral id
 * degrades the cap (a new one each session) without breaking the button — the
 * honest trade, since the cap is a courtesy against double-taps, not a security
 * control.
 */

import { newId } from './id.ts';

const STORAGE_KEY = 'dbhm.deviceId';

/** UUID v4, the shape `confirmSubmissionSchema` requires on the server. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session fallback when localStorage is unavailable; see the module note. */
let ephemeral: string | undefined;

/**
 * The id for this device, minting and persisting one on first use.
 *
 * A stored value that is not a UUID is replaced rather than sent. The server
 * rejects a malformed id with a 400, so passing one through would turn some
 * other page's leftover `dbhm.deviceId` into a permanently broken confirm
 * button, with no way for a rider to guess what to clear.
 */
export function getDeviceId(): string {
  try {
    const storage = globalThis.localStorage;
    // No storage object at all (SSR, a locked-down embed) takes the ephemeral
    // path deliberately. Optional-chaining the write instead would silently mint
    // a NEW id on every call — the cap would then see every tap as a new device
    // and suppress nothing, while looking like it worked.
    if (!storage) {
      ephemeral ??= newId();
      return ephemeral;
    }
    const stored = storage.getItem(STORAGE_KEY);
    if (stored && UUID_RE.test(stored)) return stored;
    const minted = newId();
    storage.setItem(STORAGE_KEY, minted);
    return minted;
  } catch {
    // Private window, blocked site data, or a quota error.
    ephemeral ??= newId();
    return ephemeral;
  }
}

/** Forget this device's id. Exported for the privacy surface and for tests. */
export function clearDeviceId(): void {
  ephemeral = undefined;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
