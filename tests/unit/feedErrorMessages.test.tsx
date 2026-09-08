/**
 * Issue #200 — the feed-load error a rider reads must come from the catalog.
 *
 * `useHazards` set `error` from `err.message` and `App` handed that straight to
 * `ListView`'s `role="alert"` and `MapView`'s feed notice, which rendered it
 * verbatim. Both branches were untranslated English: the common one is the
 * SERVER's own sentence (`body.message`, composed by a server with no catalog),
 * and the fallback was the literal `Could not load hazards.` in the hook. The
 * alert around them was catalogued, so a Spanish rider got a translated heading
 * over an English sentence.
 *
 * An English regex cannot catch that — correct output and defective output are
 * both English under the default catalog. Formatting under a catalog whose
 * values are SENTINELS can: anything that never reached the catalog comes back
 * as its English literal and fails. Same technique as `libErrorMessages.test.tsx`
 * (#173), which is the shape this fix follows.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIntl, IntlProvider, type IntlShape } from 'react-intl';
import { render, screen, waitFor } from '@testing-library/react';
import { feedErrorLabel } from '../../src/i18n/labels.ts';
import { apiFailureOf, fetchHazards, ApiRequestError, type ApiFailure } from '../../src/lib/api.ts';
import { useHazards } from '../../src/hooks/useHazards.ts';
import { ListView } from '../../src/components/ListView.tsx';
import { MapDataNotice } from '../../src/components/MapView.tsx';
import en from '../../src/i18n/locales/en.json';

/** Every member of the union. Adding a code without a message fails below. */
const CODES: ApiFailure[] = ['offline', 'request', 'server', 'parse'];

const SENTINELS = Object.fromEntries(
  CODES.map((code) => [`error.feed.${code}`, `⟦feed.${code}⟧`]),
) as Record<string, string>;

const sentinelIntl: IntlShape = createIntl({
  locale: 'en',
  defaultLocale: 'en',
  messages: SENTINELS,
});

/** The server's own sentence, in the shape a real 5xx sends it. */
const SERVER_SENTENCE = 'Upstream hazard database is unavailable';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function Harness() {
  const { hazards, loading, error, refresh } = useHazards({});
  return <ListView hazards={hazards} loading={loading} error={error} onRetry={refresh} />;
}

function renderWithSentinels(ui: React.ReactElement) {
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={SENTINELS}>
      {ui}
    </IntlProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('feed failure codes resolve through the catalog (#200)', () => {
  it.each(CODES)('"%s" comes from the catalog, not from the module', (code) => {
    expect(feedErrorLabel(sentinelIntl, code)).toBe(SENTINELS[`error.feed.${code}`]);
  });

  it('every code in the union has a message in the shipped en catalog', () => {
    // Self-limiting in both directions: a new code with no message fails here
    // rather than rendering as an empty alert, and a message left behind by a
    // deleted code fails too.
    const catalogued = Object.keys(en).filter((id) => id.startsWith('error.feed.'));
    expect(catalogued.sort()).toEqual(CODES.map((c) => `error.feed.${c}`).sort());
  });
});

describe('the transport classifies failures instead of describing them', () => {
  it('a 5xx is a server failure and keeps the sentence off the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'boom', message: SERVER_SENTENCE }, 503)),
    );
    const err = await fetchHazards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe('server');
    expect((err as ApiRequestError).status).toBe(503);
    // The sentence is retained as a diagnostic — it just is not the code.
    expect((err as ApiRequestError).message).toBe(SERVER_SENTENCE);
  });

  it('a 4xx is a request failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)));
    await expect(fetchHazards().catch((e: ApiRequestError) => e.code)).resolves.toBe('request');
  });

  it('a rejected fetch is offline, and the browser text is kept as cause', async () => {
    const cause = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
    const err = (await fetchHazards().catch((e: unknown) => e)) as ApiRequestError;
    expect(err.code).toBe('offline');
    expect(err.cause).toBe(cause);
  });

  it('a 200 whose body is not JSON is a parse failure, not a network one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response),
    );
    const err = (await fetchHazards().catch((e: unknown) => e)) as ApiRequestError;
    expect(err.code).toBe('parse');
  });

  it('anything not thrown by this module is reported as offline', () => {
    expect(apiFailureOf(new Error('something else entirely'))).toBe('offline');
    expect(apiFailureOf('a string throw')).toBe('offline');
  });
});

describe("the rendered alert is the catalog's sentence, not the thrown one", () => {
  it('ListView announces the catalogued text and never the server sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'boom', message: SERVER_SENTENCE }, 503)),
    );

    renderWithSentinels(<Harness />);

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert).toHaveTextContent('⟦feed.server⟧');
    // The assertion that would have failed before this change.
    expect(document.body.textContent).not.toContain(SERVER_SENTENCE);
  });

  it('ListView announces the catalogued text when the feed is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderWithSentinels(<Harness />);

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert).toHaveTextContent('⟦feed.offline⟧');
    expect(document.body.textContent).not.toContain('Failed to fetch');
    // And not the literal the hook used to carry in this branch.
    expect(document.body.textContent).not.toContain('Could not load hazards');
  });

  it.each(CODES)('MapView’s feed notice resolves "%s" through the catalog', (code) => {
    renderWithSentinels(<MapDataNotice feedError={code} />);
    expect(screen.getByRole('alert')).toHaveTextContent(`⟦feed.${code}⟧`);
  });
});
