// Current OpenDex release shown across the marketing site.
//
// Injected at build time from the newest git tag via VITE_OPENDEX_VERSION
// (see .github/workflows/pages.yml). The fallback is only used for local
// `pnpm dev`/`pnpm build` where the env var isn't set — keep it roughly in
// sync with the latest release so dev previews aren't wildly stale.
export const VERSION = import.meta.env.VITE_OPENDEX_VERSION ?? "1.1.1";
