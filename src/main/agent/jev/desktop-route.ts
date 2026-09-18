/**
 * Turn-start desktop routing via Jev.
 *
 * Opening apps through the full LLM+tool loop is the slow path users hit most
 * often ("open Safari", "launch Slack"). Jev classifies the utterance into a
 * typed route in one cheap parallel evaluate call; clear open_* routes can skip
 * the language model entirely.
 *
 * Computer-use still needs a vision LLM for clicks/typing — Jev only decides
 * whether that's the right bucket (and biases the system prompt when it is).
 */

import { evaluateWithJev } from "./evaluate";

export const DESKTOP_ROUTES = [
  "open_app",
  "open_url",
  "open_path",
  "computer",
  "other",
] as const;

export type DesktopRoute = (typeof DESKTOP_ROUTES)[number];

export interface DesktopRouteResult {
  route: DesktopRoute;
  /** Probability of the selected choice (0..1), when the provider returned a distribution. */
  probability: number;
  latencyMs: number;
}

const ROUTE_CRITERIA: Record<DesktopRoute, string> = {
  open_app:
    "Launch an installed desktop application by name (Safari, Chrome, Slack, Notes, Spotify, Terminal, Finder, …). No clicking UI elements — just start the app.",
  open_url:
    "Open a website or http(s)/mailto URL in the default browser. Includes 'go to example.com' / 'open github.com'.",
  open_path:
    "Open a file or folder on disk by path (e.g. ~/Documents, /tmp/report.pdf).",
  computer:
    "Control the already-visible desktop with mouse/keyboard: click buttons, type into fields, drag, scroll, take screenshots, or multi-step UI work inside apps. Not a simple 'open/launch X' request.",
  other:
    "Questions, search, weather, time, conversation, or anything that is not opening something or controlling the screen.",
};

/** Minimum selected-option probability before we trust the route. */
export const ROUTE_CONFIDENCE = 0.8;

export async function routeDesktopIntent(
  utterance: string,
  signal?: AbortSignal,
): Promise<DesktopRouteResult | null> {
  const text = utterance.trim();
  if (!text || !process.env.AI_GATEWAY_API_KEY) return null;

  const started = Date.now();
  try {
    const result = await evaluateWithJev({
      signal,
      state: { utterance: text },
      questions: {
        route: {
          type: "choice",
          instructions:
            "You are routing a single voice command for a desktop voice assistant. Pick the single best handler.",
          criteria: ROUTE_CRITERIA,
        },
      },
    });

    const answer = result.answers.route;
    if (answer.type !== "choice") return null;
    const route = answer.choice as DesktopRoute;
    if (!DESKTOP_ROUTES.includes(route)) return null;
    const probability = answer.probabilities?.[answer.choice] ?? 0;
    return { route, probability, latencyMs: Date.now() - started };
  } catch (err) {
    console.warn("[opendex jev] route failed, falling back to LLM", err);
    return null;
  }
}

export type OpenTarget =
  | { kind: "app"; name: string }
  | { kind: "url"; url: string }
  | { kind: "path"; path: string };

/** Pull an open target out of a short utterance once Jev has classified the route.
 *  Jev itself has no free-form string output — extraction is local. Returns null
 *  when the target is too ambiguous to trust (caller falls back to the LLM). */
export function extractOpenTarget(
  utterance: string,
  route: Extract<DesktopRoute, "open_app" | "open_url" | "open_path">,
): OpenTarget | null {
  const text = utterance.trim();
  if (!text) return null;

  if (route === "open_url") {
    const mailto = text.match(/\b(mailto:[^\s]+)/i)?.[1];
    if (mailto) return { kind: "url", url: mailto };

    const explicit = text.match(/\b(https?:\/\/[^\s]+)/i)?.[1];
    if (explicit) return { kind: "url", url: stripTrailingPunct(explicit) };

    // "open github.com" / "go to example.org/foo"
    const domain = text.match(
      /\b(?:open|launch|go to|visit|browse(?:\s+to)?)\s+((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i,
    )?.[1];
    if (domain) return { kind: "url", url: `https://${stripTrailingPunct(domain)}` };

    return null;
  }

  if (route === "open_path") {
    const path = text.match(
      /\b(?:open|show|reveal)\s+((?:~|\/)[^\s]+)/i,
    )?.[1];
    if (path) return { kind: "path", path: stripTrailingPunct(path) };
    return null;
  }

  // open_app
  const app = text.match(
    /\b(?:please\s+)?(?:can you\s+|could you\s+)?(?:open|launch|start|run|fire up|bring up|pull up)\s+(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?(?:\s+for me)?(?:\s+please)?[.!?]*$/i,
  )?.[1];
  if (!app) return null;
  const name = cleanAppName(app);
  return name ? { kind: "app", name } : null;
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,!?;:]+$/g, "");
}

function cleanAppName(raw: string): string | null {
  let name = stripTrailingPunct(raw.trim());
  // Drop leading articles left over from "open the Notes app".
  name = name.replace(/^(?:the|my|a|an)\s+/i, "");
  // Reject leftovers that look like a full sentence / UI instruction.
  if (!name || name.length > 48) return null;
  if (/\b(and|then|click|type|into|on the|window)\b/i.test(name)) return null;
  return name;
}

export function isOpenRoute(
  route: DesktopRoute,
): route is "open_app" | "open_url" | "open_path" {
  return route === "open_app" || route === "open_url" || route === "open_path";
}
