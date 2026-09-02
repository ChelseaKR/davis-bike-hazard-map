#!/usr/bin/env python3
"""Documentation-inventory and link audit, generated from the tree (never typed).

Ported from nearmiss's ``tools/doc_audit.py`` (nearmiss issue #159, commit
``8cac44f``), which closed the identical defect there. ``docs/DOCUMENTATION-AUDIT.md``
was a hand-written table of ``pass`` verdicts backed by counted evidence. The verdicts
stayed; the counts stopped describing this repository — "68 test files" against 77,
"8 workflow files" against 10, and a "full hand-authored doc inventory" that omitted
``CLAUDE.md``, ``docs/RESEARCH-ROADMAP.md``, ``docs/USER-RESEARCH.md``, every file
under ``docs/adr/``, and more. Nothing generated or checked the file, so a document
whose entire purpose was to show that the project's process claims are real was itself
a validation surface reporting success about records it no longer inspected. That is
the failure pattern this repository polices everywhere else.

This tool removes the possibility. It regenerates the machine-derived block of that
document between its ``BEGIN GENERATED`` / ``END GENERATED`` markers, so every count is
read off the tree at the commit that ships it:

    make docs-audit          # rewrite the generated block
    make docs-audit-check    # fail if the committed block has drifted

Three deliberate choices about honesty, the first two inherited from nearmiss:

* **``pass`` is reserved for a real predicate.** Presence checks (does ``README.md``
  exist?) and the link check (does every relative link resolve?) can pass or fail. An
  inventory count cannot — "77 test files" is not a verdict — so counts are reported
  as ``info``. The old table's standing ``pass`` on "Validation surface | 68 test
  files" is exactly the kind of borrowed authority that reads as a conformance result.
* **No generated timestamp.** A date in the output would drift every day and make the
  drift check meaningless, and the git history already dates the file. The dated
  narrative of the original 2026-07-11 sweep is kept *outside* the generated block, as
  history, where it cannot masquerade as a current verdict.
* **Links that leave the repository are counted, not resolved.** nearmiss's version
  falls back to ``Path.exists()`` for a link that escapes the tree. This repository's
  README links a sibling checkout (``../STANDARDS/``) that exists on a laptop and
  never exists on a CI runner, so resolving those would make the gate pass or fail on
  where it ran. They are reported separately instead.

``--check`` asserts the audit's own predicates, not only that the file is current.
Until 2026-08-28 it did exactly one thing: re-render the block and compare it to the
committed text. That made "the file is up to date" the *only* proposition it could
ever fail on, and it let two failures through green:

* **A failing predicate, regenerated.** Break a relative link, run ``make docs-audit``,
  and the committed block honestly records ``| Local doc links resolve | fail |`` plus
  an "Unresolved links" section naming the broken link. Because the block then matched
  the tree, ``--check`` printed "doc audit OK" and exited 0. The documented remedy for
  a merge conflict in this file is "run ``make docs-audit`` and commit the result", so
  the ordinary conflict-resolution workflow was also the way to launder a real failure
  into a green gate.
* **Nothing to audit.** Against a tree with no ``README.md``, no ``tests/`` and no
  ``.github/workflows/``, every presence row rendered ``fail`` and the gate still
  exited 0, reporting success having inspected zero test files, zero workflows and
  zero links.

Both are the failure this file was created to remove — a validation surface reporting
success about records it did not inspect — reintroduced one level up, in the checker
rather than in the document. So the predicates are now evaluated against the tree and
asserted directly, the audit fails closed when it finds nothing to audit or cannot read
what it found, and regenerating cannot turn a failing predicate green.

Exit codes: ``0`` green; ``1`` the committed block has drifted from the tree; ``2`` the
audit itself failed (a predicate is failing, there was nothing to audit, or an input
could not be read).

Pure standard library; no network; deterministic (identical tree, identical bytes).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Iterable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "docs" / "DOCUMENTATION-AUDIT.md"

# Exit codes, distinguished so a failure says which kind it is.
EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_AUDIT_FAILED = 2


class AuditError(RuntimeError):
    """The audit could not be performed. Never reported as a pass.

    Raised when an input cannot be read or parsed, or when a surface the audit
    exists to inspect is empty. An audit that inspected nothing has not passed;
    it has failed to run, and the two must never render identically.
    """


BEGIN = "<!-- BEGIN GENERATED: doc-audit (scripts/doc_audit.py) -->"
END = "<!-- END GENERATED: doc-audit -->"

# Directory names with no hand-authored documentation to audit, excluded wherever they
# appear. Matching on the name rather than a root-relative prefix matters: the audit
# has to produce the same numbers whether or not `npm ci` has created `node_modules`,
# or `make build`/`make e2e` have created `dist`/`playwright-report`, in this checkout.
EXCLUDED_DIR_NAMES = frozenset(
    {
        ".git",
        ".husky",
        ".standards",
        "__pycache__",
        "backups",
        "coverage",
        "data",
        "dev-dist",
        "dist",
        "dist-server",
        "node_modules",
        "playwright-report",
        "test-results",
    }
)

# Individual generated artifacts that land inside an otherwise-authored directory.
# `tests/i18n/en-XA.generated.json` is written by `npm run i18n:pseudo:gen` and
# gitignored, so counting it would make `make docs-audit-check` pass or fail depending
# on whether the i18n gates had been run in this checkout.
EXCLUDED_FILES = frozenset({"tests/i18n/en-XA.generated.json"})

ROOT_PROCESS_DOCS = ("CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md")
ROOT_LEGAL_DOCS = ("LICENSE", "NOTICE", "CITATION.cff", "CODE_OF_CONDUCT.md")
ROOT_TEMPLATES = (".github/PULL_REQUEST_TEMPLATE.md", ".github/CODEOWNERS")

# Category rules, in order: the first prefix/name that matches wins. Written as data so
# the categorization is reviewable rather than buried in branches.
CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "safety, privacy, accessibility, and audits",
        (
            "docs/DOCUMENTATION-AUDIT.md",
            "docs/RESPONSIBLE-TECH-AUDITS.md",
            "docs/audits/",
        ),
    ),
    ("architecture and interfaces", ("docs/ARCHITECTURE.md", "docs/adr/", "migrations/")),
    (
        "planning and research",
        (
            "docs/ideation/",
            "docs/PROJECT-SCOPE.md",
            "docs/RESEARCH-ROADMAP.md",
            "docs/ROADMAP.md",
            "docs/USER-RESEARCH.md",
        ),
    ),
    ("operations", ("BETA.md", "docs/ops/")),
    ("internationalization", ("docs/I18N.md", "i18n/")),
)
ENTRY_AND_PROCESS = (
    ".github/CODEOWNERS",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "CHANGELOG.md",
    "CITATION.cff",
    "CLAUDE.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "DEFINITION_OF_DONE.md",
    "LICENSE",
    "NOTICE",
    "README.md",
    "SECURITY.md",
    "docs/README.md",
)
OTHER = "other docs"

# Representative files shown per category. The complete list is printed below the
# tables, so the table stays readable without hiding anything.
_SAMPLE = 5

# A relative Markdown link: [text](target). Absolute URLs, mailto: and pure anchors are
# out of scope — this check is about links that must resolve inside the tree.
_LINK = re.compile(r"\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)")
_SKIP_LINK = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)")
_CODE_FENCE = re.compile(r"(?ms)^```.*?^```\s*?$")

# A Vitest/Playwright test declaration, at the start of a line so a `describe` body's
# prose or a commented-out block does not inflate the count.
_TEST_DECL = re.compile(r"^\s*(?:it|test)(?:\.\w+)*\s*\(", re.M)


def _relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _read_text(path: Path) -> str:
    """Read a file the audit depends on, or fail closed.

    A document that cannot be decoded is not a document with nothing in it. Letting
    the read raise a bare traceback, or worse skipping the file, would let the audit
    report on a subset of the tree while presenting as a report on all of it.
    """
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise AuditError(f"cannot read {_relative(path)}: {exc}") from exc


def _read_json(path: Path) -> dict:
    """Parse a JSON input the audit depends on, or fail closed."""
    try:
        parsed = json.loads(_read_text(path))
    except json.JSONDecodeError as exc:
        raise AuditError(f"cannot parse {_relative(path)} as JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise AuditError(f"{_relative(path)} is not a JSON object")
    return parsed


def _excluded(rel: str) -> bool:
    if rel in EXCLUDED_FILES:
        return True
    return any(part in EXCLUDED_DIR_NAMES for part in rel.split("/")[:-1])


def _authored_docs() -> list[str]:
    """Every hand-authored Markdown file, plus the non-Markdown root process files."""
    found: set[str] = set()
    for path in ROOT.rglob("*.md"):
        rel = _relative(path)
        if _excluded(rel):
            continue
        found.add(rel)
    for rel in (*ROOT_LEGAL_DOCS, *ROOT_TEMPLATES):
        if (ROOT / rel).is_file():
            found.add(rel)
    return sorted(found)


def _category(rel: str) -> str:
    for name, prefixes in CATEGORY_RULES:
        if any(rel == prefix or rel.startswith(prefix) for prefix in prefixes):
            return name
    if rel in ENTRY_AND_PROCESS:
        return "entry points and repo process"
    return OTHER


def _test_files() -> list[str]:
    directory = ROOT / "tests"
    if not directory.is_dir():
        return []
    return sorted(
        _relative(p) for p in directory.rglob("*") if p.is_file() and not _excluded(_relative(p))
    )


def _test_declarations(files: Iterable[str]) -> int:
    total = 0
    for rel in files:
        if not rel.endswith((".ts", ".tsx")):
            continue
        total += len(_TEST_DECL.findall(_read_text(ROOT / rel)))
    return total


def _workflows() -> list[str]:
    workflows = ROOT / ".github" / "workflows"
    if not workflows.is_dir():
        return []
    return sorted(_relative(p) for p in (*workflows.glob("*.yml"), *workflows.glob("*.yaml")))


def _adrs() -> list[str]:
    adr = ROOT / "docs" / "adr"
    return sorted(_relative(p) for p in adr.glob("*.md")) if adr.is_dir() else []


def _migrations() -> list[str]:
    directory = ROOT / "migrations"
    return sorted(_relative(p) for p in directory.glob("*.sql")) if directory.is_dir() else []


def _package() -> tuple[str, str, list[str]]:
    data = _read_json(ROOT / "package.json")
    return data.get("name", "unknown"), data.get("version", "unknown"), sorted(data.get("scripts", {}))


def _locale_catalogs() -> list[tuple[str, int, int]]:
    """(catalog, keys, values that are still empty) for each FormatJS locale file."""
    locales = ROOT / "src" / "i18n" / "locales"
    if not locales.is_dir():
        return []
    out = []
    for path in sorted(locales.glob("*.json")):
        catalog = _read_json(path)
        empty = 0
        for value in catalog.values():
            message = value.get("defaultMessage", "") if isinstance(value, dict) else value
            if not str(message).strip():
                empty += 1
        out.append((_relative(path), len(catalog), empty))
    return out


def _link_targets(text: str) -> Iterable[str]:
    for raw in _LINK.findall(_CODE_FENCE.sub("", text)):
        target = raw.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1]
        target = target.split(" ")[0].split("#")[0].strip()
        if not target or _SKIP_LINK.match(target):
            continue
        yield target


def _exists_case_sensitively(target: Path) -> bool:
    """Does this path exist with *exactly* this spelling?

    ``Path.exists()`` is case-insensitive on macOS (APFS) and case-sensitive on the
    Linux hosts CI runs on and on github.com, so a link whose case is wrong passes on a
    laptop and 404s for every reader. Each component is matched against the real
    directory listing so this gate agrees with github.com rather than with the
    filesystem it happens to run on.
    """
    cursor = ROOT
    for part in target.relative_to(ROOT).parts:
        try:
            entries = {entry.name for entry in cursor.iterdir()}
        except OSError:
            return False
        if part not in entries:
            return False
        cursor = cursor / part
    return True


def _check_links(docs: Iterable[str]) -> tuple[int, int, list[str]]:
    """(links checked, links pointing outside the repo, unresolved 'doc -> target')."""
    checked = 0
    external = 0
    unresolved: list[str] = []
    for rel in docs:
        path = ROOT / rel
        if path.suffix != ".md":
            continue
        for target in _link_targets(_read_text(path)):
            # Textual normalisation only: realpath would fold `..` *and*, on some
            # platforms, the case this check exists to catch.
            resolved = Path(os.path.normpath(path.parent / target))
            if not resolved.is_relative_to(ROOT):
                # A sibling checkout such as `../STANDARDS/`: present on a laptop,
                # absent on every CI runner. Resolving it would make this gate depend
                # on where it ran, so it is counted and not judged.
                external += 1
                continue
            checked += 1
            if not _exists_case_sensitively(resolved):
                unresolved.append(f"{rel} -> {target}")
    return checked, external, unresolved


def _present(paths: Iterable[str]) -> list[str]:
    return [p for p in paths if not (ROOT / p).exists()]


def _verdict(missing: list[str]) -> str:
    return "pass" if not missing else "fail"


def _bullets(items: Iterable[str]) -> str:
    return "\n".join(f"- `{item}`" for item in items)


# Surfaces this audit exists to inspect. Each must be non-empty for the run to mean
# anything: a report of "0 test files, 0 workflow files, 0 links checked" is not a
# clean tree, it is an audit that found nothing and must say so. The floor is `> 0`
# rather than a remembered number on purpose — a hard-coded expected count would be
# the typed-figure defect this tool was written to delete, and would go stale the
# first time a test was added.
def _floors(
    docs: list[str],
    markdown_docs: list[str],
    tests: list[str],
    workflows: list[str],
    links_checked: int,
) -> list[str]:
    surfaces = (
        ("hand-authored docs", len(docs)),
        ("Markdown documents", len(markdown_docs)),
        ("test files under `tests/`", len(tests)),
        ("workflow files under `.github/workflows/`", len(workflows)),
        ("in-repo relative links", links_checked),
    )
    return [
        f"found no {surface} to audit; an audit that inspected nothing cannot pass"
        for surface, count in surfaces
        if count == 0
    ]


def _render() -> tuple[str, list[str]]:
    """Render the generated block, and report every way the audit itself failed.

    The failures are returned rather than only rendered into the text, so that
    `--check` can assert them against the tree. Writing `fail` into the document
    makes a record; returning it here is what makes it a gate.
    """
    docs = _authored_docs()
    tests = _test_files()
    workflows = _workflows()
    checked, external, unresolved = _check_links(docs)
    name, version, scripts = _package()

    missing_process = _present(ROOT_PROCESS_DOCS)
    missing_legal = _present(ROOT_LEGAL_DOCS)
    missing_templates = _present(ROOT_TEMPLATES)
    readme_missing = [] if (ROOT / "README.md").is_file() else ["README.md"]

    categories: dict[str, list[str]] = {}
    for rel in docs:
        categories.setdefault(_category(rel), []).append(rel)

    markdown_docs = [d for d in docs if d.endswith(".md")]
    lines: list[str] = [
        BEGIN,
        "",
        "_Everything between these markers is generated by `scripts/doc_audit.py` from the "
        "tree at this commit. Do not edit it by hand: run `make docs-audit`. "
        "`make docs-audit-check` fails if it has drifted, and `make verify` runs that check._",
        "",
        "## Presence and link checks",
        "",
        "These are real predicates, so they can pass or fail.",
        "",
        "| Check | Result | Evidence |",
        "| --- | --- | --- |",
        f"| Entry doc | {_verdict(readme_missing)} | `README.md`"
        f"{'' if not readme_missing else ' missing'} |",
        f"| Root process docs | {_verdict(missing_process)} | "
        f"{', '.join(f'`{p}`' for p in ROOT_PROCESS_DOCS)} |",
        f"| Root legal, citation, and conduct docs | {_verdict(missing_legal)} | "
        f"{', '.join(f'`{p}`' for p in ROOT_LEGAL_DOCS)} |",
        f"| Root-adjacent GitHub templates | {_verdict(missing_templates)} | "
        f"{', '.join(f'`{p}`' for p in ROOT_TEMPLATES)} |",
        f"| Local doc links resolve | {_verdict(unresolved)} | {checked} in-repo relative links "
        f"checked in {len(markdown_docs)} Markdown files; {len(unresolved)} unresolved; "
        f"{external} outside the repository (counted, not checked) |",
        "",
        "## Inventory",
        "",
        "Counts, not verdicts. A count cannot pass or fail; it can only be current, which is "
        "what generating it from the tree buys.",
        "",
        "| Surface | Count | Evidence |",
        "| --- | ---: | --- |",
        f"| Hand-authored docs | {len(docs)} | Markdown anywhere in the tree outside build and "
        "dependency directories, plus the root legal and template files |",
        f"| Test files | {len(tests)} | every file under `tests/` |",
        f"| Test declarations | {_test_declarations(tests)} | `it(`/`test(` in `tests/**/*.ts`"
        " and `*.tsx` |",
        f"| Workflow files | {len(workflows)} | `.github/workflows/*.yml` |",
        f"| Architecture decision records | {len(_adrs())} | `docs/adr/*.md` |",
        f"| Database migrations | {len(_migrations())} | `migrations/*.sql` |",
        "",
        "### By category",
        "",
        f"Up to {_SAMPLE} representative files per category; the complete list follows below.",
        "",
        "| Category | Count | Representative files |",
        "| --- | ---: | --- |",
    ]
    for category in sorted(categories):
        members = sorted(categories[category])
        shown = ", ".join(f"`{m}`" for m in members[:_SAMPLE])
        extra = len(members) - _SAMPLE
        lines.append(
            f"| {category} | {len(members)} | {shown}"
            f"{f', plus {extra} more' if extra > 0 else ''} |"
        )

    catalogs = _locale_catalogs()
    lines += [
        "",
        "## Workflow files checked",
        "",
        _bullets(workflows) or "- none found",
        "",
        "## Package and localization metadata",
        "",
        f"- Node package `{name}` at version `{version}`"
        f" (scripts: {', '.join(f'`{s}`' for s in scripts) or 'none'}).",
    ]
    for catalog, keys, empty in catalogs:
        lines.append(
            f"- Locale catalog `{catalog}`: {keys} keys, {empty} with an empty message."
        )
    lines += [
        "",
        "## Full hand-authored doc inventory",
        "",
        _bullets(docs),
        "",
    ]
    if unresolved:
        lines += ["## Unresolved links", "", _bullets(unresolved), ""]
    lines.append(END)

    failures: list[str] = []
    if readme_missing:
        failures.append("entry doc missing: `README.md`")
    for label, missing in (
        ("root process docs", missing_process),
        ("root legal, citation, and conduct docs", missing_legal),
        ("root-adjacent GitHub templates", missing_templates),
    ):
        if missing:
            failures.append(f"{label} missing: {', '.join(f'`{m}`' for m in missing)}")
    for link in unresolved:
        failures.append(f"unresolved local link: {link}")
    failures += _floors(docs, markdown_docs, tests, workflows, checked)

    return "\n".join(lines) + "\n", failures


def _splice(document: str, generated: str) -> str:
    start = document.find(BEGIN)
    end = document.find(END)
    if start == -1 or end == -1:
        raise AuditError(
            f"docs/DOCUMENTATION-AUDIT.md is missing the generated-block markers "
            f"({BEGIN} … {END})"
        )
    return document[:start] + generated + document[end + len(END) + 1 :]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Regenerate the documentation audit.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the committed generated block differs from the tree",
    )
    args = parser.parse_args(argv)

    document = _read_text(AUDIT)
    generated, failures = _render()
    updated = _splice(document, generated)

    def _report_failures() -> None:
        print(
            "doc audit FAILED: the audit's own checks do not hold against this tree.\n"
            "  Regenerating will NOT fix these — the document would faithfully record a\n"
            "  failure, which is not the same as passing. Fix the tree:",
            file=sys.stderr,
        )
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)

    if args.check:
        # Predicates first. A failing predicate is a worse finding than a stale file,
        # and telling someone to "run `make docs-audit` and commit the result" when a
        # link is broken is precisely how a real failure used to be laundered green.
        if failures:
            _report_failures()
            return EXIT_AUDIT_FAILED
        if updated != document:
            print(
                "doc audit FAILED: docs/DOCUMENTATION-AUDIT.md no longer describes this tree.\n"
                "  Run `make docs-audit` and commit the result.",
                file=sys.stderr,
            )
            return EXIT_DRIFT
        print("doc audit OK: the committed inventory, counts, and link check match the tree.")
        return EXIT_OK

    # Write first, so the document records what is actually true, then fail on it. The
    # record and the verdict are separate things and neither substitutes for the other.
    AUDIT.write_text(updated, encoding="utf-8")
    print(f"doc audit: regenerated the generated block in {_relative(AUDIT)}.")
    if failures:
        _report_failures()
        return EXIT_AUDIT_FAILED
    return EXIT_OK


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AuditError as exc:
        # Fail closed: an audit that could not read or parse what it set out to
        # inspect has not passed, and must not exit 0 or spray a traceback that
        # reads as a crash rather than a verdict.
        print(f"doc audit FAILED: {exc}", file=sys.stderr)
        raise SystemExit(EXIT_AUDIT_FAILED) from exc
