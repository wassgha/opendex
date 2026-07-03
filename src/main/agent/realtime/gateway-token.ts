// Mints the short-lived realtime connection token via the Vercel AI Gateway.
// Runs in MAIN only — the gateway key lives in process.env (set by the config
// store's applyToEnv) and never reaches the renderer; the token it buys is
// single-use and expires in seconds, so handing it over is safe.
import { gateway } from "@ai-sdk/gateway";

export interface RealtimeToken {
  token: string;
  url: string;
}

/** Mint a connection token for one realtime session. Throws a user-facing
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
