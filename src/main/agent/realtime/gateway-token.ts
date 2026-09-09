// Gateway connection details stay in main. The SDK currently returns the raw
// Gateway key, so neither the token nor the authenticated socket reaches IPC.
import { gateway } from "@ai-sdk/gateway";

export interface RealtimeToken {
  token: string;
  url: string;
}

/** Resolve connection credentials for one realtime session. Throws a user-facing
 *  reason (spoken by the renderer) when the key is missing. */
export async function mintRealtimeToken(model: string): Promise<RealtimeToken> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "I need a Vercel AI Gateway key for realtime voice. Please add one in Settings under Voice mode.",
    );
  }
  const { token, url } = await gateway.experimental_realtime.getToken({ model });
  return { token, url };
}
