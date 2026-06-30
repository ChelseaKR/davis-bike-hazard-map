import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array, isPushSupported } from '../../src/lib/push.ts';

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID key (and pads correctly)', () => {
    // "hello" → base64 "aGVsbG8=" → base64url "aGVsbG8" (no padding).
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles the url-safe alphabet (- and _)', () => {
    // 0xff 0xfe 0xfd → base64 "//79" → base64url "__79".
    const bytes = urlBase64ToUint8Array('__79');
    expect(Array.from(bytes)).toEqual([0xff, 0xfe, 0xfd]);
  });
});

describe('isPushSupported', () => {
  it('returns false in jsdom (no PushManager)', () => {
    expect(isPushSupported()).toBe(false);
  });
});
