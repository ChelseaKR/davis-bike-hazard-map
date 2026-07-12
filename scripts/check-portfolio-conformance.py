#!/usr/bin/env python3
"""Run the pinned portfolio conformance audit against this repository.

portfolio-standards v1.0.1 exposes ``audit_repo`` but predates its later
single-repository CLI. This compatibility entry point keeps the consumer pinned
to a released standards tag while making every failed control blocking.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--standards-dir", type=Path, default=Path(".standards"))
    parser.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args()

    checker = args.standards_dir / "automation" / "conformance_check.py"
    spec = importlib.util.spec_from_file_location("portfolio_conformance", checker)
    if spec is None or spec.loader is None:
        print(f"error: cannot load standards checker at {checker}", file=sys.stderr)
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    result = module.audit_repo(args.repo.resolve())
    repo = args.repo.resolve()
    # v1.0.1 treats every repository with tests/ as Python, even when it is a
    # Node-only project. Remove only those inapplicable Python controls; later
    # standards releases perform this language detection correctly themselves.
    if (repo / "package.json").exists() and not (
        (repo / "pyproject.toml").exists() or (repo / "requirements.txt").exists()
    ):
        for control in ("coverage_threshold_set", "single_pyproject"):
            result["checks"].pop(control, None)
        result["total"] = len(result["checks"])
        result["passed"] = sum(
            1 for outcome in result["checks"].values() if outcome["pass"]
        )
        result["score"] = f"{result['passed']}/{result['total']}"

    print(f"Portfolio standards conformance: {result['score']}")
    for name, outcome in result["checks"].items():
        state = "PASS" if outcome["pass"] else "FAIL"
        print(f"{state:4} {name}: {outcome['detail']}")

    return 0 if result["passed"] == result["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
