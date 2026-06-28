# Contributing to OpenDex

OpenDex is a voice-first agentic desktop app (Electron + React + Tailwind). Two
things are designed to be **drop-in folders** so you can extend the app without
touching its internals:

- **Skills** (and their tools + result cards) live in `src/skills/<name>/`
- **Themes** (the whole on-screen experience) live in
  `src/renderer/src/components/themes/<id>/`

This guide covers both. For the deeper architecture (process model, IPC, voice
state machine), see `AGENTS.md`.

## Getting started

```bash
pnpm install
pnpm dev          # run the app with HMR
pnpm typecheck    # tsc --noEmit — run this before opening a PR
pnpm smoke:chat   # exercise the agent loop without launching Electron
```

OpenDex is an Electron app with three processes. What matters for contributors:

- **Main** (`src/main/`, Node) owns the agent loop, API keys, and OS access.
- **Renderer** (`src/renderer/`, React) is the UI. It never sees secrets.
- A **skill spans both** — its executable half runs in main, its UI half in the
  renderer. They're co-located in one folder and linked only by a tool-name
  string. The build only bundles each half into its own process.

---

## Adding a skill

A skill bundles one or more **tools** the agent can call (e.g. `getWeather`).
Create a folder `src/skills/<name>/` with up to three files:

```
src/skills/weather/
  meta.ts     # id, label, description, sensitivity + tool-name constants  (shared, no deps)
  skill.ts    # the executable tools: inputSchema + execute                (MAIN — zod / node / ai)
  view.tsx    # optional: tool labels + result cards                       (RENDERER — React)
```

### 1. `meta.ts` — the contract (dependency-free)

Declares the tool names once (imported by both `skill.ts` and `view.tsx`) plus
the renderer-safe metadata that drives the Settings → "Skills & tools" UI. Keep
this file free of `node`, `electron`, `ai`, and `react` imports.

```ts
import type { SkillMeta } from "../types";

export const TOOLS = { getWeather: "getWeather" } as const;

export const meta: SkillMeta = {
  id: "weather",
  label: "Weather",
  description: "Look up the current weather and a brief forecast for a place.",
  sensitive: false, // true → every call is gated behind a permission prompt
  // optIn: true,   // off until the user enables it (for powerful/risky skills)
};
```

### 2. `skill.ts` — the executable (main process)

Spread `meta` and define each tool's `inputSchema` (zod) and `execute`. This
runs in Node/Electron, so you may use `node:*` and `electron` here.

```ts
import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

export const weatherSkill: Skill = {
  ...meta,
  tools: [
    {
      name: TOOLS.getWeather,
      description: "Get the current weather for a location.",
      inputSchema: z.object({ location: z.string() }),
      // For `sensitive` skills, a one-line summary shown in the permission prompt:
      // summarize: (i) => `Weather in ${(i as { location: string }).location}`,
      execute: async ({ location }: { location: string }) => {
        // ... return plain JSON the model (and your card) can read
        return { place: location, /* … */ };
      },
    },
  ],
};
```

Then register it (one line) in `src/skills/registry.ts`:

```ts
import { weatherSkill } from "./weather/skill";
export const BUILTIN_SKILLS: Skill[] = [/* … */ weatherSkill];
```

> Why one explicit line and not auto-discovery? The main registry is also loaded
> by `pnpm smoke:chat` (via `tsx`), which doesn't transform `import.meta.glob`.
> Explicit imports keep the smoke test working — and make the tool set obvious.

### 3. `view.tsx` — labels + result card (renderer, optional)

Register a **label** (the activity banner) and optionally a **Card** (rendered in
the conversation thread). This file is **auto-discovered** — no registry edit.

```tsx
import { TOOLS } from "./meta";
import { registerToolView } from "../tool-registry";
import type { ToolViewProps } from "../tool-view";

function WeatherCard({ result, status, surface }: ToolViewProps) {
  if (status !== "done") return <div>Checking the weather…</div>;
  // `surface` is "main" | "notch" | "overlay" — branch for compact vs full.
  return <div>{/* … */}</div>;
}

registerToolView({
  name: TOOLS.getWeather,
  label: (input) => ({ icon: "🌤️", label: "Check the weather" }),
  Card: WeatherCard, // omit for label-only tools (e.g. a mouse click)
});
```

Card guidelines:

- Style with **theme tokens** (`bg-card`, `text-foreground`, `border-border`, …)
  so the card adapts to every theme. Give a card its own colors only when it has
  a strong identity (e.g. the weather card's sky gradient).
- Handle the `running` / `error` states (result is `null` until the tool returns).
- Use the `surface` prop for density: a full panel on `"main"`, a glance on
  `"notch"`. If you omit `Card`, the tool shows only its banner label.
- Need a quick card without writing one? Import `GenericCard` from
  `../generic-card` and pass it as `Card`.

That's it. The skill appears in Settings, its tools are available to the agent
(gated if `sensitive`), and its card renders in the thread, the notch, and the
overlay.

---

## Adding a theme

A theme renders the **entire** main experience (visualization + status +
transcript + controls). Create a folder
`src/renderer/src/components/themes/<id>/index.tsx` that **default-exports** a
`DexThemeDef`. It's **auto-discovered** — no registry edit.

```tsx
import type { DexThemeProps, DexThemeDef } from "../types";

function MyTheme(props: DexThemeProps) {
  // props has everything: status, transcript, liveCaption, getAmplitude(),
  // toolInvocations, isMuted, onSubmitText, toggleMute, onNewConversation, …
  return <div className="flex flex-1 …">{/* your whole UI */}</div>;
}

function MyPreview() {
  // a small, static (no-audio) glyph for the theme picker
  return <span className="h-3 w-3 rounded-full bg-white" />;
}

const theme: DexThemeDef = {
  id: "my-theme",
  label: "My Theme",
  description: "One line shown in the picker tooltip.",
  order: 5, // lower sorts first in the picker
  Component: MyTheme,
  Preview: MyPreview,
};

export default theme;
```

### Reuse the shared chrome

`themes/shared/` has the building blocks most themes want — compose them instead
of reinventing:

- `MinimalShell` — solid background, top bar, push-to-talk, optional bottom
  transcript overlay. The dot and cursor themes are thin wrappers over it.
- `ThemeTopBar` — the standard mute / new-conversation / minimize / settings
  controls. Pass the matching `props.*` handlers.
- `TextComposer` — the concealed type-to-talk affordance.
- `OverlayTranscript` — bottom-anchored transcript that renders tool cards inline.
- `useAmplitudeFrame` — drive a visual from mic loudness without React re-renders.

### Surfacing tool result cards

Render `<ToolCardLayer invocations={props.toolInvocations} surface="main" />`
(from `@skills/tool-card-layer`) wherever cards should appear in your theme — it
shows the latest tool result as a card in the conversation flow. `MinimalShell`
and `OverlayTranscript` already do this for you.

---

## Conventions

- **Run `pnpm typecheck` before a PR.** There's no separate lint/test gate yet.
- Match the surrounding code's comment density and naming. Comments explain
  *why*, not *what*.
- Keep `meta.ts` dependency-free, and never import a skill's `skill.ts` from the
  renderer (it pulls in node/electron). The renderer only imports `meta.ts` and
  `view.tsx`.
- Secrets stay in the main process. If a skill needs a key, read it from
  `process.env` inside `execute` and return a friendly error when it's missing
  (see `web-search/skill.ts`).
