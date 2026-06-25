/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Latest OpenDex release, injected at build time from the newest git tag
  // (see .github/workflows/pages.yml). Unset during local `pnpm dev`.
  readonly VITE_OPENDEX_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
