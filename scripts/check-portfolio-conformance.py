#!/usr/bin/env python3
"""Run the pinned portfolio conformance audit against this repository.

The pinned standards release is recorded in ``.standards-version`` and fetched
by ``.github/workflows/standards.yml`` at the same ref. From v2.0.0 the shared
checker ships its own single-repository entry point, so this wrapper no longer
reimplements one: it loads the pinned ``conformance_check.py`` and delegates to
``run_single_repo``.

Delegating matters for more than tidiness. The previous wrapper called
``audit_repo(repo)`` directly, which skipped the applicability-manifest lookup
that scopes declared-N/A standards out of the score and resolves this repo's
``publication:`` state — so the RTF-16 publication gate defaulted to
``restricted`` on a repo the manifest has cleared for public. It also predated
v2.0.0's correct Node/Python language detection and had to delete two Python-
only controls by hand; v2.0.0 never adds them to a Node repo in the first
place.

``--strict`` is always on: every failing control blocks. Hosted checks
(branch-protection policy, repository visibility) are off by default because
this job runs with no authenticated ``gh``, where they would only ever skip;
pass ``--network`` once a token is available to actually exercise them.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--standards-dir", type=Path, default=Path(".standards"))
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument(
        "--network",
        action="store_true",
        help="also run the hosted branch-policy and publication-state checks",
    )
    args = parser.parse_args()

    checker = args.standards_dir / "automation" / "conformance_check.py"
    spec = importlib.util.spec_from_file_location("portfolio_conformance", checker)
    if spec is None or spec.loader is None:
        print(f"error: cannot load standards checker at {checker}", file=sys.stderr)
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return int(
        module.run_single_repo(
            args.repo.resolve(),
            0.0,
            True,
            False,
            check_network=args.network,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
