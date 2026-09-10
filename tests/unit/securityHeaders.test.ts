/**
 * Guard: the CSP `upgrade-insecure-requests` switch, in both directions.
 *
 * Background, because this directive cost the repository a check.
 *
 * `upgrade-insecure-requests` is one of helmet's default directives, so the
 * explicit directive list in server/app.ts inherits it. On the deployed site
 * that is right and free — fly terminates TLS and every page is https.
 *
 * Over plain `http://` it is fatal, in exactly one browser engine. The
 * directive rewrites every subresource URL in the document to `https://`, and
 * WebKit applies it on loopback; Chromium and Firefox exempt `localhost` as a
 * potentially-trustworthy origin. The e2e harness serves the production build
 * over `http://localhost:8788`, so under WebKit every `/assets/*.js` fetch went
 * to `https://localhost:8788/...`, died in a TLS handshake against a plaintext
 * port, and left `#root` empty. The nightly WebKit workflow failed on 55 of 55
 * runs from 2026-07-18 to 2026-09-10 for that reason and no other, and reported
 * `success` every time because its job was `continue-on-error: true`.
 *
 * Hence `serverConfig.cspUpgradeInsecureRequests`, and hence this file. Three
 * things are pinned:
 *
 *  1. the directive is emitted by default (production behaviour is unchanged);
 *  2. turning it off removes that directive and NOTHING else, so the switch
 *     cannot be used to quietly widen the policy;
 *  3. the e2e harness actually sets it. Without (3) the fix is one careless
 *     edit from regressing, and the only check that would notice is the
 *     nightly — the check this whole exercise exists to make trustworthy.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';
import e2eConfig from '../../playwright.config.ts';

const baseConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  sessionSecret: 'test-session-secret',
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000, confirmationsPerHour: 10_000 },
} as typeof serverConfig;

/** The Content-Security-Policy header the app serves, split into directives. */
async function cspDirectives(upgradeInsecureRequests: boolean): Promise<string[]> {
  const app = await buildApp({
    repo: new MemoryRepository(),
    config: { ...baseConfig, cspUpgradeInsecureRequests: upgradeInsecureRequests },
    logger: false,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const header = res.headers['content-security-policy'];
    expect(
      typeof header,
      'no Content-Security-Policy header was served at all; this guard would ' +
        'otherwise pass by comparing two empty lists',
    ).toBe('string');
    return String(header)
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
  } finally {
    await app.close();
  }
}

describe('CSP upgrade-insecure-requests switch', () => {
  it('emits a real policy, so the comparisons below are not over nothing', async () => {
    const on = await cspDirectives(true);
    // A floor: helmet's defaults plus this app's own list is well over five
    // directives. A header that stopped being assembled would satisfy every
    // "does not contain" assertion in this file.
    expect(on.length, `only ${on.length} directives were served`).toBeGreaterThan(5);
    expect(on).toContain("default-src 'self'");
    expect(on).toContain("script-src 'self'");
    expect(on).toContain("frame-ancestors 'none'");
  });

  it('emits upgrade-insecure-requests by default', async () => {
    expect(await cspDirectives(true)).toContain('upgrade-insecure-requests');
  });

  it('omits it when the switch is off', async () => {
    expect(await cspDirectives(false)).not.toContain('upgrade-insecure-requests');
  });

  it('changes nothing else when the switch is off', async () => {
    const on = await cspDirectives(true);
    const off = await cspDirectives(false);
    expect(off).toEqual(on.filter((d) => d !== 'upgrade-insecure-requests'));
    // And the switch really is doing something, or the line above is a
    // tautology over two identical lists.
    expect(off.length).toBe(on.length - 1);
  });
});

describe('the e2e harness turns the directive off', () => {
  // The *imported* config, not the file's text. The first version of this
  // guard read playwright.config.ts as a string and passed over a config with
  // the variable deleted, because the comment explaining why it must not be
  // deleted also contains the string. Reading the value the harness will
  // actually run is the only version of this check that cannot be satisfied
  // by prose about itself.
  const command = (e2eConfig.webServer as { command?: string } | undefined)?.command;

  it('exposes a web-server command to inspect', () => {
    // Floor: an undefined or restructured command would make the assertion
    // below pass over nothing (`undefined` contains no substring, so it would
    // throw — but a config that stopped booting the server at all should say
    // so in its own words).
    expect(typeof command, 'playwright.config.ts declares no webServer.command').toBe('string');
    expect(command).toContain('tsx server/index.ts');
  });

  it('sets CSP_UPGRADE_INSECURE_REQUESTS=false in the web-server command', () => {
    expect(
      command,
      'playwright.config.ts serves the production build over plain http on ' +
        'localhost. Without CSP_UPGRADE_INSECURE_REQUESTS=false, WebKit ' +
        'upgrades every asset request to https:// against a plaintext port, ' +
        'the app never boots, and all 11 e2e tests time out — which is what ' +
        'the nightly WebKit workflow did on 55 of 55 runs before 2026-09-10.',
    ).toContain('CSP_UPGRADE_INSECURE_REQUESTS=false');
  });
});
