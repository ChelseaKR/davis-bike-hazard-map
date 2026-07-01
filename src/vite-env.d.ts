/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_TILE_URL?: string;
  /** Test-only: exposes the i18n test hook for the G9 pseudolocale overflow spec. Never set in production. */
  readonly VITE_I18N_TEST_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
