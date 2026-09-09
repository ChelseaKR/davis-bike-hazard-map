/**
 * Issue #203 — the reason a rider reads under a report that failed to sync must
 * come from the catalog.
 *
 * `MyReports` rendered the device queue's `lastError` verbatim. That value is
 * untranslated English in both of its branches: the common one is
 * `ApiRequestError.message`, i.e. the SERVER's own sentence (`body.message`,
 * composed by a server with no catalog), and the fallback is `String(err)` on a
 * non-`Error` throw. The card around them is catalogued, so a Spanish rider got
 * a translated card over an English reason — the same defect #200 removed from
 * the feed, on a second surface.
 *
 * Neither i18n gate could see it. Pass A flags string LITERALS in JSX and
 * `{r.lastError}` is an expression; pass B scans `src/lib/api.ts`, where the
 * literal carries an `i18n-exempt` reason. The two are the same string on a
 * rider's screen and nothing related them.
 *
 * An English regex cannot catch this — correct output and defective output are
 * both English under the default catalog. Formatting under a catalog whose
 * values are SENTINELS can: anything that never reached the catalog comes back
 * as its English literal and fails. Same technique as `feedErrorMessages`
 * (#200) and `libErrorMessages` (#173).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIntl, IntlProvider, type IntlShape } from 'react-intl';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { queueErrorLabel } from '../../src/i18n/labels.ts';
import { syncOnce } from '../../src/lib/sync.ts';
import { ApiRequestError, type ApiFailure } from '../../src/lib/api.ts';
import {
  enqueueReport,
  getReport,
  updateReport,
  _resetDbForTests,
  type QueuedReport,
} from '../../src/lib/db.ts';
import { MyReports } from '../../src/components/MyReports.tsx';
import en from '../../src/i18n/locales/en.json';
import type { ReportSubmission } from '../../shared/types.ts';

/** Every member of the union. Adding a code without a message fails below. */
const CODES: ApiFailure[] = ['offline', 'request', 'server', 'parse'];

const SENTINELS: Record<string, string> = {
  ...Object.fromEntries(CODES.map((code) => [`error.queue.${code}`, `⟦queue.${code}⟧`])),
  'error.queue.unrecorded': '⟦queue.unrecorded⟧',
  'queue.state.error': '⟦state.error⟧',
};

const sentinelIntl: IntlShape = createIntl({
  locale: 'en',
  defaultLocale: 'en',
  messages: SENTINELS,
});

/** The server's own sentence, in the shape a real rejection sends it. */
const SERVER_SENTENCE = 'Report rejected: capturedAt is in the future';

function submission(id: string): ReportSubmission {
  return {
    category: 'pothole',
    severity: 'high',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: id,
    capturedAt: Date.now(),
  };
}

function renderWithSentinels(ui: ReactElement) {
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={SENTINELS}>
      {ui}
    </IntlProvider>,
  );
}

beforeEach(async () => {
  await _resetDbForTests();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in tests')));
});

afterEach(() => vi.unstubAllGlobals());

describe('queue failure codes resolve through the catalog (#203)', () => {
  it.each(CODES)('"%s" comes from the catalog, not from the module', (code) => {
    expect(queueErrorLabel(sentinelIntl, code)).toBe(SENTINELS[`error.queue.${code}`]);
  });

  it('every code in the union has a message in the shipped en catalog', () => {
    // Self-limiting in both directions: a new code with no message fails here
    // rather than rendering as the absence sentence, and a message left behind
    // by a deleted code fails too. `unrecorded` is deliberately in the list and
    // deliberately NOT in `ApiFailure` — it describes a missing code.
    const catalogued = Object.keys(en).filter((id) => id.startsWith('error.queue.'));
    expect(catalogued.sort()).toEqual(
      [...CODES.map((c) => `error.queue.${c}`), 'error.queue.unrecorded'].sort(),
    );
  });
});

describe('an absent code is rendered as absence, not as one of the four (#203)', () => {
  it('no recorded code resolves to the absence sentence', () => {
    expect(queueErrorLabel(sentinelIntl, undefined)).toBe('⟦queue.unrecorded⟧');
  });

  it('the absence sentence is not any of the four reasons', () => {
    // The defect class this repo keeps hitting: "no data" published as a real
    // value. Picking `offline` for a row that never recorded a reason would
    // tell a rider their connection failed when nothing measured that.
    const absent = queueErrorLabel(sentinelIntl, undefined);
    for (const code of CODES) {
      expect(absent).not.toBe(queueErrorLabel(sentinelIntl, code));
    }
  });

  it('a code this build does not recognise resolves to absence rather than throwing', () => {
    // The argument comes off an IndexedDB row, so its type is a claim about
    // what this build wrote, not about what is on the device. A `formatMessage`
    // on an undefined descriptor throws; a blank render says nothing at all.
    expect(queueErrorLabel(sentinelIntl, 'teapot')).toBe('⟦queue.unrecorded⟧');
    expect(queueErrorLabel(sentinelIntl, '')).toBe('⟦queue.unrecorded⟧');
  });
});

describe('the device queue records a code, not a sentence (#203)', () => {
  it('a permanent rejection stores the code and keeps the sentence as a diagnostic', async () => {
    await enqueueReport(submission('a'));
    await syncOnce({
      submit: vi.fn().mockRejectedValue(new ApiRequestError(SERVER_SENTENCE, 400, 'request')),
    });

    const row = await getReport('a');
    expect(row?.state).toBe('error');
    expect(row?.lastErrorCode).toBe('request');
    // Retained — it is the only thing that explains an unrecognised code later,
    // and a bug report needs the original text. It is simply never displayed.
    expect(row?.lastError).toBe(SERVER_SENTENCE);
  });

  it('a non-Error throw is classified rather than stringified into the code', async () => {
    await enqueueReport(submission('a'));
    await syncOnce({ submit: vi.fn().mockRejectedValue('a string throw') });

    const row = await getReport('a');
    expect(row?.lastErrorCode).toBe('offline');
    expect(row?.lastErrorCode).not.toContain(' ');
  });
});

describe("MyReports renders the catalog's sentence, not the stored one (#203)", () => {
  async function errored(over: Partial<QueuedReport>) {
    await enqueueReport(submission('a'));
    await updateReport('a', { state: 'error', attempts: 1, ...over });
  }

  it('a row with a code renders that code through the catalog', async () => {
    await errored({ lastErrorCode: 'request', lastError: SERVER_SENTENCE });

    renderWithSentinels(<MyReports />);

    expect(await screen.findByText('⟦queue.request⟧')).toBeInTheDocument();
    // The assertion that would have failed before this change.
    expect(document.body.textContent).not.toContain(SERVER_SENTENCE);
  });

  it('a row written before the code existed does not render its stale sentence', async () => {
    // IndexedDB survives an upgrade, so this row is on real devices: state
    // 'error' and a `lastError` sentence, with no `lastErrorCode` at all.
    await errored({ lastError: SERVER_SENTENCE });

    renderWithSentinels(<MyReports />);

    expect(await screen.findByText('⟦queue.unrecorded⟧')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SERVER_SENTENCE);
  });

  it('an errored row with nothing recorded still says why it is showing nothing', async () => {
    // The old guard was `r.state === 'error' && r.lastError`, so this row
    // printed a card reading "Couldn't sync" with no reason under it at all —
    // indistinguishable from a report that is fine.
    await errored({});

    renderWithSentinels(<MyReports />);

    expect(await screen.findByText('⟦queue.unrecorded⟧')).toBeInTheDocument();
  });

  it('a report that has not failed shows no reason line', async () => {
    // The other half of the guard: a refusal test needs a case that must be let
    // through, or it is satisfied by a renderer that prints a reason on every
    // report there is.
    await enqueueReport(submission('a'));

    renderWithSentinels(<MyReports />);

    await screen.findByText('Pothole');
    expect(screen.queryByText('⟦queue.unrecorded⟧')).not.toBeInTheDocument();
    for (const code of CODES) {
      expect(screen.queryByText(`⟦queue.${code}⟧`)).not.toBeInTheDocument();
    }
  });
});
