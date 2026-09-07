/**
 * `docs/ADAPTING-A-TOWN.md`'s "What is still Davis-shaped" list, held against
 * the tree.
 *
 * That list is the honest answer to "how far is this from being a pattern
 * rather than a product", and issue #181 is scoped by it. A list nothing checks
 * drifts in both directions, and it had drifted in both:
 *
 *  - it claimed the **tile and routing service URLs** were still hard-coded.
 *    They are not, and were not: `VITE_TILE_URL`, `ROUTING_URL` and
 *    `OSM_NOTES_API_URL` are read from the environment and default to
 *    OpenStreetMap-project services that are identical for every town. Listing
 *    finished work as outstanding makes the remaining work look larger than it
 *    is, which is the same failure as claiming work that does not exist.
 *
 *  - it did **not** mention that `server/lib/osmNotes.ts` writes the Davis name
 *    into notes posted to OpenStreetMap. That is the item on the list that
 *    actually escapes this system: OSM notes are public and permanent, so a
 *    second town would publish its hazards into OSM under Davis's name.
 *
 * These tests are deliberately narrow. A blanket "no source file may contain
 * the string Davis" rule would fire on every doc comment that discusses the
 * Davis pack, and a gate that cries wolf gets deleted — so this checks the
 * specific claims the document makes, and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOsmNotePayload } from '../../server/lib/osmNotes.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

/**
 * Read a repo file from the working directory (the repo root, where vitest
 * runs). NOT via `new URL(..., import.meta.url)`: the jsdom environment
 * replaces the global `URL`, which resolves a relative path against
 * `http://localhost:3000/` instead of the module's `file:` URL, and the read
 * then silently misses the document. `readFileSync` throws ENOENT on a wrong
 * path, so a broken lookup fails the gate rather than passing over an empty
 * string that contains nothing and therefore violates nothing.
 */
const repoFile = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/** The place name the shipped pack is built around. */
const PLACE_NAME = 'Davis';

/** The "What is still Davis-shaped" section, on its own. */
function remainderSection(): string {
  const doc = repoFile('docs/ADAPTING-A-TOWN.md');
  const start = doc.indexOf('## What is still Davis-shaped');
  expect(start, 'the remainder section is gone from docs/ADAPTING-A-TOWN.md').toBeGreaterThan(-1);
  const end = doc.indexOf('\n## ', start + 1);
  return end === -1 ? doc.slice(start) : doc.slice(start, end);
}

describe('the tile and routing services are deployment configuration', () => {
  // These three are the correction. If a future change hard-codes any of them,
  // the document's statement stops being true and this is where that shows up.
  it('the client reads its tile template from VITE_TILE_URL', () => {
    expect(repoFile('src/config.ts')).toContain('import.meta.env.VITE_TILE_URL');
  });

  it('the server reads its routing and OSM Notes endpoints from the environment', () => {
    const config = repoFile('server/config.ts');
    expect(config).toContain('process.env.ROUTING_URL');
    expect(config).toContain('process.env.OSM_NOTES_API_URL');
  });

  it('the remainder list no longer claims those URLs are hard-coded', () => {
    // The correction is a sentence in the document; this pins the claim, not the
    // wording. The list must not say the tile or routing URLs are still to do.
    const section = remainderSection();
    const bullets = section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .join('\n');
    expect(bullets).not.toMatch(/tile and routing service URLs/i);
  });
});

describe('the remainder list names what is genuinely still Davis-shaped', () => {
  // Every source path the list points at must still carry the place name. When
  // one of them is parameterised, this fails -- and the fix is to take it off
  // the list, not to weaken the test. Listing finished work as outstanding is
  // the drift this whole file exists to catch.
  const listed = [
    'src/i18n/locales/en.json',
    'server/lib/osmNotes.ts',
    'server/openapi.ts',
    'server/lib/openapi-registry.ts',
  ];

  for (const path of listed) {
    it(`${path} still names ${PLACE_NAME}, as the document says`, () => {
      expect(
        repoFile(path).includes(PLACE_NAME),
        `${path} no longer names ${PLACE_NAME}. If that was deliberate, take it off ` +
          'the "What is still Davis-shaped" list in docs/ADAPTING-A-TOWN.md.',
      ).toBe(true);
    });

    it(`the document points at ${path}`, () => {
      expect(remainderSection()).toContain(path);
    });
  }

  it('the tile attribution is a literal with no environment override', () => {
    const clientConfig = repoFile('src/config.ts');
    expect(clientConfig).toContain('tileAttribution');
    // The line itself, so an override added later is noticed here as well as in
    // the document. `tileUrl` above it has one; this deliberately does not.
    const line = clientConfig
      .split('\n')
      .findIndex((l) => l.includes('tileAttribution:'));
    expect(line).toBeGreaterThan(-1);
    expect(clientConfig.split('\n').slice(line, line + 2).join('\n')).not.toContain(
      'import.meta.env',
    );
  });
});

describe('an OSM note names the deployment, and that name leaves this system', () => {
  function stored(over: Partial<StoredHazard> = {}): StoredHazard {
    return {
      id: 'haz-1',
      clientId: 'c1',
      category: 'dangerous_intersection',
      severity: 'high',
      description: 'Cars run the light',
      preciseLocation: { lat: 38.5449, lng: -121.7405 },
      publicLocation: { lat: 38.545, lng: -121.74 },
      photo: null,
      status: 'approved',
      source: 'report',
      confirmations: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      expiresAt: 1_800_000_000_000,
      moderation: [],
      ...over,
    };
  }

  // Behavioural rather than textual: this is what would actually be posted.
  // Both branches of the back-link are checked, because the one without a
  // configured public base URL is the one that repeats the name a second time.
  it('puts the place name in the note body with no public base URL configured', () => {
    const { text } = buildOsmNotePayload(stored(), { enabled: false });
    expect(text).toContain(`${PLACE_NAME} Bike Hazard Map`);
    expect(text).toContain(`${PLACE_NAME} Bike Hazard Map reference haz-1`);
  });

  it('still puts the place name in the note body when a base URL is configured', () => {
    const { text } = buildOsmNotePayload(stored(), {
      enabled: false,
      publicBaseUrl: 'https://example.test/',
    });
    expect(text).toContain('https://example.test/#hazard=haz-1');
    expect(text).toContain(`${PLACE_NAME} Bike Hazard Map`);
  });
});
