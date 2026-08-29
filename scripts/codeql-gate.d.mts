/**
 * Types for scripts/codeql-gate.mjs.
 *
 * The gate is plain ESM with no imports outside `node:`, so the CodeQL job can
 * run it without an `npm ci` — a security gate that needs the dependency tree
 * installed before it can grade anything is a gate with more ways to not run.
 * That costs a hand-written declaration file, so `tests/unit/codeqlGate.test.ts`
 * asserts these names match the module's real exports; a signature added there
 * and forgotten here fails the build rather than drifting.
 */

/** A SARIF reporting descriptor, as far as this gate cares. */
export interface SarifRule {
  id: string;
  defaultConfiguration?: { level?: string };
}

/** A SARIF result, as far as this gate cares. */
export interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: {
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number };
    };
  }[];
}

export interface SarifRun {
  tool?: {
    driver?: { rules?: SarifRule[] };
    extensions?: { rules?: SarifRule[] }[];
  };
  results?: SarifResult[];
}

export interface SarifDocument {
  runs?: SarifRun[];
}

/** A reviewed and accepted finding. Every field is mandatory and non-empty. */
export interface Acknowledgement {
  ruleId: string;
  path: string;
  reason: string;
  /**
   * The codeql.yml matrix language this entry belongs to. One list serves every
   * matrix leg, and each leg sees only its own SARIF, so an entry is in scope
   * (for excusing a finding AND for the staleness check) only in its own leg.
   */
  language: string;
}

export interface Finding {
  ruleId: string;
  path: string;
  line: number | null;
  /** Resolved level, or null when it could not be resolved (which fails the gate). */
  level: string | null;
  message: string;
}

export interface Grade {
  findings: Finding[];
  /** Everything that must fail the build. Empty means pass. */
  problems: string[];
}

export function resolveLevel(result: SarifResult, rulesById: Map<string, SarifRule>): string | null;
export function rulesForRun(run: SarifRun): Map<string, SarifRule>;
export function gradeSarif(
  documents: SarifDocument[],
  acknowledgements?: Acknowledgement[],
  language?: string,
): Grade;
export function loadAcknowledgements(path: string): Acknowledgement[];
