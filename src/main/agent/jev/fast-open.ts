/**
 * Fast path for clear "open app / URL / path" commands.
 *
 * When Jev routes with high confidence and we can extract a target locally,
 * execute the Open skill tool directly (still permission-gated) and speak a
 * short confirmation — skipping the language-model tool loop entirely.
 */

import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import type { PermissionRequester } from "../../../skills/types";
import { openSkill } from "../../../skills/open/skill";
import { TOOLS } from "../../../skills/open/meta";
import {
  extractOpenTarget,
  isOpenRoute,
  ROUTE_CONFIDENCE,
  routeDesktopIntent,
  type DesktopRouteResult,
  type OpenTarget,
} from "./desktop-route";

export interface FastOpenHandlers {
  onDelta: (text: string) => void;
  onToolCall?: (call: { toolCallId: string; toolName: string; input: unknown }) => void;
  onToolResult?: (result: {
    toolCallId: string;
    toolName: string;
    output: unknown;
  }) => void;
}

export type FastOpenOutcome =
  | {
      kind: "handled";
      messages: ModelMessage[];
      route: DesktopRouteResult;
      target: OpenTarget;
    }
  | {
      kind: "hint";
      route: DesktopRouteResult;
      /** System-prompt addendum for the LLM fallthrough. */
      systemAddendum: string;
      /** When set, narrow the tool set to these skill ids. */
      skillFilter?: string[];
    }
  | { kind: "skip" };

/**
 * Attempt the Jev-accelerated open path. Returns `handled` when the open tool
 * ran; `hint` when we should still call the LLM but with a route bias; `skip`
 * when Jev is unavailable / unsure / irrelevant.
 */
export async function tryJevDesktopFastPath(opts: {
  utterance: string;
  openEnabled: boolean;
  computerEnabled: boolean;
  requestPermission: PermissionRequester;
  signal?: AbortSignal;
  handlers: FastOpenHandlers;
}): Promise<FastOpenOutcome> {
  const routed = await routeDesktopIntent(opts.utterance, opts.signal);
  if (!routed || routed.probability < ROUTE_CONFIDENCE) return { kind: "skip" };
  if (opts.signal?.aborted) return { kind: "skip" };

  if (isOpenRoute(routed.route)) {
    if (!opts.openEnabled) return { kind: "skip" };

    const target = extractOpenTarget(opts.utterance, routed.route);
    if (target) {
      const handled = await executeOpenTarget({
        target,
        requestPermission: opts.requestPermission,
        handlers: opts.handlers,
        signal: opts.signal,
      });
      if (handled) {
        return {
          kind: "handled",
          messages: handled,
          route: routed,
          target,
        };
      }
      // Permission denied or tool error already spoken — still "handled" so we
      // don't also burn an LLM turn. executeOpenTarget returns messages either way.
    }

    // Confident it's an open request but we couldn't parse the target — keep
    // the LLM, but only expose Open tools so it doesn't wander into computer-use.
    return {
      kind: "hint",
      route: routed,
      skillFilter: ["open"],
      systemAddendum:
        "This utterance is an open/launch request (Jev route=" +
        `${routed.route}, p=${routed.probability.toFixed(2)}). ` +
        "Use openApp, openUrl, or openPath only — do not drive the mouse or take screenshots.",
    };
  }

  if (routed.route === "computer" && opts.computerEnabled) {
    return {
      kind: "hint",
      route: routed,
      systemAddendum:
        "This utterance is a desktop-control request (Jev route=computer, " +
        `p=${routed.probability.toFixed(2)}). Prefer computer tools. ` +
        "Do not call openApp/openUrl unless the user explicitly asked to launch something.",
    };
  }

  return { kind: "skip" };
}

async function executeOpenTarget(opts: {
  target: OpenTarget;
  requestPermission: PermissionRequester;
  handlers: FastOpenHandlers;
  signal?: AbortSignal;
}): Promise<ModelMessage[] | null> {
  if (opts.signal?.aborted) return null;

  const { toolName, input, spokenOk, spokenFail } = describeTarget(opts.target);
  const tool = openSkill.tools.find((t) => t.name === toolName);
  if (!tool) return null;

  const detail = tool.summarize ? tool.summarize(input) : toolName;
  const allowed = await opts.requestPermission(openSkill.id, openSkill.label, detail);
  if (opts.signal?.aborted) return null;

  const toolCallId = randomUUID();
  opts.handlers.onToolCall?.({ toolCallId, toolName, input });

  let output: unknown;
  if (!allowed) {
    output = { error: "Permission denied by the user." };
  } else {
    try {
      output = await tool.execute(input as never);
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  opts.handlers.onToolResult?.({ toolCallId, toolName, output });

  const failed =
    !!output &&
    typeof output === "object" &&
    "error" in (output as object) &&
    Boolean((output as { error?: unknown }).error);

  const spoken = !allowed
    ? "I need permission to do that."
    : failed
      ? spokenFail(String((output as { error: unknown }).error))
      : spokenOk;

  opts.handlers.onDelta(spoken);

  // Match the AI SDK tool-loop message shape so later turns remember the action.
  const messages: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName,
          input,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: failed
            ? { type: "error-text", value: String((output as { error: unknown }).error) }
            : { type: "json", value: output as never },
        },
      ],
    },
    { role: "assistant", content: spoken },
  ];
  return messages;
}

function describeTarget(target: OpenTarget): {
  toolName: string;
  input: Record<string, string>;
  spokenOk: string;
  spokenFail: (err: string) => string;
} {
  switch (target.kind) {
    case "app":
      return {
        toolName: TOOLS.openApp,
        input: { name: target.name },
        spokenOk: `Opening ${target.name}.`,
        spokenFail: (err) => `I couldn't open ${target.name}: ${err}`,
      };
    case "url":
      return {
        toolName: TOOLS.openUrl,
        input: { url: target.url },
        spokenOk: `Opening ${target.url}.`,
        spokenFail: (err) => `I couldn't open that link: ${err}`,
      };
    case "path":
      return {
        toolName: TOOLS.openPath,
        input: { path: target.path },
        spokenOk: `Opening ${target.path}.`,
        spokenFail: (err) => `I couldn't open that path: ${err}`,
      };
  }
}
