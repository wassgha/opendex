import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { OpenDexConfig } from "../../config/schema";

/** Result of probing whether the Apple on-device model can be used right now. */
export interface AppleAvailability {
  available: boolean;
  /** Human-readable reason when unavailable (OS too old, Intelligence off, …). */
  reason?: string;
}

/**
 * Maps the configured provider to a concrete AI SDK model. Returns either a
 * `LanguageModel` instance (direct providers, apple) or a bare model-id string
 * (the gateway path, resolved by the SDK's global Vercel AI Gateway provider).
 *
 * Throws a user-facing error for providers that can't run — the chat handler
 * surfaces the message as a spoken apology.
 */
export async function resolveModel(config: OpenDexConfig): Promise<LanguageModel> {
  const { provider, model } = config.llm;
  switch (provider) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) throw new Error("no OpenAI API key is set");
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("no Anthropic API key is set");
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model);
    case "apple": {
      // Native (Swift/Rust), macOS-only — dynamic-imported so non-darwin builds
      // never load the binary, and the chunk is only pulled when selected.
      const { appleAI, appleAISDK } = await import("@meridius-labs/apple-on-device-ai");
      const { available, reason } = await appleAISDK.checkAvailability();
      if (!available) throw new Error(reason || "Apple Intelligence is unavailable");
      return appleAI("apple-on-device");
    }
    case "opendex":
      throw new Error("the OpenDex subscription isn't available yet");
    case "gateway":
    default:
      // A bare model id routes through the SDK's global AI Gateway provider,
      // which reads AI_GATEWAY_API_KEY from the environment.
      return model;
  }
}

/** Probe Apple on-device availability for the UI (provider picker gate). Never
 *  throws — a missing binary / unsupported platform resolves to unavailable. */
export async function checkAppleAvailability(): Promise<AppleAvailability> {
  if (process.platform !== "darwin") {
    return { available: false, reason: "Requires macOS on Apple Silicon" };
  }
  try {
    const { appleAISDK } = await import("@meridius-labs/apple-on-device-ai");
    return await appleAISDK.checkAvailability();
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : "Apple Intelligence is unavailable",
    };
  }
}
