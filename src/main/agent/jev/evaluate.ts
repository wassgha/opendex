/**
 * Thin Gateway client for evaluation models (Jev). Evaluation is not exposed on
 * the OpenAI-compatible Gateway endpoints and needs AI SDK 7's
 * `experimental_evaluate` — we call the Gateway `/v4/ai/evaluation-model`
 * route directly so the rest of OpenDex can stay on AI SDK 6 (realtime canary).
 */

const GATEWAY_EVAL_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
const JEV_MODEL_ID = "typesafe-ai/jev";

export type EvalQuestion =
  | {
      type: "boolean";
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type EvalAnswer =
  | { type: "boolean"; probability: number }
  | {
      type: "choice";
      choice: string;
      probabilities?: Record<string, number>;
    }
  | {
      type: "score";
      score: number;
      probabilities?: Record<string, number>;
    };

export interface EvaluateResult<Q extends Record<string, EvalQuestion>> {
  answers: { [K in keyof Q]: EvalAnswer };
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: Record<string, Record<string, unknown>>;
}

export async function evaluateWithJev<Q extends Record<string, EvalQuestion>>(opts: {
  state: unknown;
  questions: Q;
  signal?: AbortSignal;
}): Promise<EvaluateResult<Q>> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("no AI Gateway API key is set");

  const res = await fetch(GATEWAY_EVAL_URL, {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": JEV_MODEL_ID,
    },
    body: JSON.stringify({
      state: opts.state,
      questions: opts.questions,
      providerOptions: {
        gateway: { zeroDataRetention: true },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jev evaluate failed (${res.status}): ${body.slice(0, 240) || res.statusText}`);
  }

  const json = (await res.json()) as {
    answers?: Record<string, EvalAnswer>;
    usage?: { inputTokens?: number; outputTokens?: number };
    providerMetadata?: Record<string, Record<string, unknown>>;
  };
  if (!json.answers) throw new Error("Jev evaluate returned no answers");

  return {
    answers: json.answers as EvaluateResult<Q>["answers"],
    usage: json.usage,
    providerMetadata: json.providerMetadata,
  };
}
