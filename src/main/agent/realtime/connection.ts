import NodeWebSocket from "ws";
import { gateway } from "@ai-sdk/gateway";
import type { RealtimeProvider } from "../../config/schema";
import { mintRealtimeToken } from "./gateway-token";
import { openaiRealtimeCodec, type RealtimeCodec } from "./openai-codec";

export type RealtimeSocket = WebSocket | NodeWebSocket;

/** Main-only: direct credentials are sent in the upgrade header, never IPC. */
export async function connectRealtime(provider: RealtimeProvider, model: string): Promise<{ ws: RealtimeSocket; codec: RealtimeCodec }> {
  if (provider === "openai") {
    if (!model.startsWith("openai/")) throw new Error("Choose an OpenAI realtime model for OpenAI direct.");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Add an OpenAI API key in Settings under Voice mode to use OpenAI direct.");
    return {
      codec: openaiRealtimeCodec,
      ws: new NodeWebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model.slice(7))}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    };
  }
  if (provider !== "gateway") throw new Error("Unsupported realtime voice provider.");
  const { token, url } = await mintRealtimeToken(model);
  const codec = gateway.experimental_realtime(model);
  const config = codec.getWebSocketConfig({ token, url });
  return { codec, ws: new WebSocket(config.url, config.protocols) };
}
