# Releasing OpenDex

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`) whenever you push a `v*.*.*` tag. Each platform
runs on its own runner (macOS / Ubuntu / Windows), and electron-builder uploads
the installers **and** the `latest-*.yml` update manifests to a GitHub Release.
The app's auto-updater (`src/main/updater.ts`) reads those manifests straight
from the release — there is no separate update server to maintain.

## Cutting a release

From a clean working tree, run one of the cut scripts. Each bumps the version
in `package.json`, makes a `Release vX.Y.Z` commit, creates a matching `vX.Y.Z`
tag, and pushes both — which triggers the release workflow:

```bash
pnpm cut:patch   # 0.1.0 -> 0.1.1
pnpm cut:minor   # 0.1.0 -> 0.2.0
pnpm cut:major   # 0.1.0 -> 1.0.0
```

> These wrap `pnpm version <type> && git push --follow-tags`. `pnpm version`
> refuses to run with uncommitted changes, so commit your work first.

Then:

1. Watch the build at <https://github.com/wassgha/opendex/actions>.

2. electron-builder publishes to a **draft** GitHub Release. Once all three
   platform jobs finish, open <https://github.com/wassgha/opendex/releases>,
   edit the draft, add release notes, and **Publish**. Auto-update only picks
   up published (non-draft) releases.

## Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions**. The Apple
credentials are the same ones used for the other CoreViz desktop app — a single
Developer ID cert + App Store Connect API key works across app IDs.

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | password for that `.p12` |
| `APPLE_API_KEY` | base64-encoded App Store Connect API key (`.p8`) — used for notarization |
| `APPLE_API_KEY_ID` | the API key's 10-character Key ID |
| `APPLE_API_ISSUER` | the API key's Issuer ID (UUID) |

`GITHUB_TOKEN` is provided automatically by Actions — no setup needed.

> Windows and Linux builds are currently **unsigned**. To sign Windows later,
> add a code-signing cert and pass `CSC_LINK`/`CSC_KEY_PASSWORD` to the
> Windows job (electron-builder picks them up the same way).

## How signing & notarization work (macOS)

- `build.mac` in `package.json` sets `hardenedRuntime: true`, points at
  `build/entitlements.mac.plist`, and `notarize: true`.
- electron-builder imports `CSC_LINK` to sign the app + the bundled native
  `libnut` binary (nut-js, used for computer-use input control), then submits
  the build to Apple for notarization using the `APPLE_API_*` credentials and
  staples the ticket.
- The entitlements allow JIT/WASM (the offline voice engines), library
  validation bypass (loading the native binary), network access, and the
  microphone.

See the original walkthrough for generating these credentials in
`~/Development/snapbox/SIGNING_SETUP.md`.

## Testing the build locally (unsigned)

```bash
pnpm dist          # builds installers into dist/ without publishing
```

Auto-update is disabled in `pnpm dev` and only runs in packaged builds
(`app.isPackaged`).

## Notes

- An app **icon** is not yet configured — electron-builder uses the default
  Electron icon. To brand it, drop `build/icon.icns` (mac), `build/icon.ico`
  (win), and `build/icon.png` (≥512px, linux) and rebuild; electron-builder
  picks them up from `buildResources` automatically.
- The native `@nut-tree-fork/nut-js` dependency is `asarUnpack`ed so its
  platform binary loads at runtime. pnpm fetches the correct per-platform
  `libnut-*` binary on each runner.
