/**
 * Accessibility assertion helper built directly on axe-core.
 *
 * We run the WCAG 2.0/2.1/2.2 A & AA rule set — the merge-blocking floor from
 * /STANDARDS. Two caveats handled here:
 *   - `color-contrast` needs a layout engine jsdom doesn't have, so it is
 *     covered by the Playwright + @axe-core/playwright pass against a real
 *     browser instead.
 *   - Page-structure best-practice rules (landmarks, single h1) don't apply to
 *     isolated components; restricting to WCAG tags excludes them here while the
 *     full-page e2e pass still checks them.
 */
import axe from 'axe-core';
import { expect } from 'vitest';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export interface AxeCheckOptions {
  /** Extra rule IDs to disable for this run. */
  disableRules?: string[];
}

export async function checkA11y(
  container: HTMLElement,
  options: AxeCheckOptions = {},
): Promise<void> {
  const disabled = ['color-contrast', ...(options.disableRules ?? [])];
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
    resultTypes: ['violations'],
  });

  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (v) =>
          `• [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n    ${v.nodes
            .map((n) => n.target.join(' '))
            .join('\n    ')}`,
      )
      .join('\n');
    throw new Error(
      `Expected no axe violations but found ${results.violations.length}:\n${summary}`,
    );
  }

  expect(results.violations).toHaveLength(0);
}
