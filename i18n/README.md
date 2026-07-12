# Internationalization entry point

This directory is the repository-level discovery entry point for the portfolio
conformance tooling. The canonical runtime implementation and message catalogs
live under [`src/i18n`](../src/i18n/); they stay beside application source so
TypeScript imports and Vite bundling remain straightforward.

The in-scope declaration, catalog workflow, translation-review state, and gate
inventory are documented in [`docs/I18N.md`](../docs/I18N.md).
