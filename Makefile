# Davis Bike Hazard Map — developer entrypoints.
# These four targets are the contract referenced by the README and CI.

.DEFAULT_GOAL := help
.PHONY: help install dev build preview start seed verify lint typecheck test a11y e2e e2e-install audit clean

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies.
	npm install

dev: ## Run client (Vite) + API server together with hot reload.
	npm run dev

build: ## Production build of the PWA client.
	npm run build

preview: ## Serve the production build locally.
	npm run preview

start: ## Run the API server (serves the built client in production).
	npm run start

seed: ## Load a first pass of demo hazards into the data store.
	DATABASE_PATH=./data/hazards.json npm run seed

verify: ## Lint + typecheck + unit tests + build. The merge gate.
	npm run verify

lint: ## ESLint over client, server, and tests.
	npm run lint

typecheck: ## TypeScript type checking, no emit.
	npm run typecheck

test: ## Unit + component + server tests (Vitest).
	npm run test:unit

a11y: ## Accessibility tests (axe) — release gate.
	npm run a11y

e2e-install: ## Install the Playwright browser used by e2e.
	npx playwright install chromium

e2e: ## End-to-end tests (Playwright).
	npm run e2e

audit: ## Run the responsible-tech gates (privacy + accessibility tests).
	npm run a11y
	npx vitest run exif server validation

clean: ## Remove build + test artifacts.
	rm -rf dist dist-server coverage playwright-report test-results dev-dist
