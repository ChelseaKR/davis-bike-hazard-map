/**
 * Say out loud when the production store adapter was not exercised.
 *
 * `tests/unit/pgRepository.test.ts` is gated on `TEST_DATABASE_URL`. CI supplies
 * one from a `postgres:16-alpine` service; `make verify` supplies none, so the
 * only store that talks to a real database in production is skipped locally —
 * and `vitest run` reports that as an unremarkable skip count, making a green
 * local run look identical to one that covered it.
 *
 * This is a Vitest `globalSetup`, not a top-level `console.warn` in the test
 * file, because Vitest does not surface console output from a file whose every
 * suite is skipped. Global setup runs in the main process, so the notice
 * actually reaches the terminal.
 */
export function setup(): void {
  if (process.env.TEST_DATABASE_URL) return;
  process.stderr.write(
    '\n  NOTICE  The Postgres store integration suite is being SKIPPED.\n' +
      '          TEST_DATABASE_URL is unset, so the production store adapter is untested in this run.\n' +
      '          CI runs it against a postgres:16-alpine service. To run it here:\n' +
      '            docker compose up -d db\n' +
      '            TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dbhm npm run test:unit\n\n',
  );
}
