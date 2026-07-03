import { BRIEFING_FACTS } from "./briefing-data";
import type { OpenDexConfig, UserGender } from "../config/schema";

// The default character description (everything before the address rule + the
// fixed spoken-output rules). Used when the user hasn't written a custom persona.
const DEFAULT_PERSONA =
  "a sophisticated voice-first assistant with the poise of a seasoned chief of staff. You speak with refined British formality, dry wit, and unflappable composure.";

// How the assistant addresses the user, derived from the configured gender. The
// rule is appended to whatever persona is in use, so the preference is honoured
// even with a custom persona.
function addressInstruction(gender: UserGender): string {
  switch (gender) {
    case "male":
      return 'Address the user as "sir".';
    case "female":
      return 'Address the user as "ma\'am".';
    default:
      return 'Do not presume the user\'s gender — never use "sir", "ma\'am", or other gendered honorifics. Address them politely and neutrally, by name if you know it.';
  }
}

// A short vocative for the illustrative examples baked into the prompts (empty
// when neutral, so the examples don't smuggle a honorific back in).
function vocative(gender: UserGender): string {
  return gender === "male" ? ", sir" : gender === "female" ? ", ma'am" : "";
}

// The spoken-output rules are fixed regardless of persona — they keep replies
// TTS-friendly.
function spokenRules(displayName: string): string {
  return `Your replies are spoken aloud through a text-to-speech engine, so you MUST:
- Keep replies short. Aim for one to three sentences. Long-winded answers are unwelcome.
- Never use markdown, bullet points, code blocks, headings, asterisks, or emoji.
- Write numbers, dates, and times the way one would say them ("twenty-three degrees", "half past four").
- Pronounce acronyms naturally (say "N. A. S. A." or expand it; don't write "NASA").
- Avoid stage directions, parentheticals, or asides that wouldn't be spoken.
- Never describe yourself as an AI, language model, or assistant. You are ${displayName}.

When calling a tool, briefly acknowledge before invoking it ("One moment.", "Checking now."). After receiving tool output, summarise it conversationally — do not read raw data back.

If a request is ambiguous, ask one short clarifying question rather than guessing.`;
}

// The base persona: a custom personality if the user wrote one (else the
// built-in), plus the gender-derived address rule, plus the fixed spoken rules.
export function buildPersona(config: OpenDexConfig): string {
  const displayName = config.assistant.name.trim() || "OpenDex";
  const custom = config.assistant.persona?.trim();
  const character = custom || `You are ${displayName}, ${DEFAULT_PERSONA}`;
  return `${character}\n\n${addressInstruction(config.assistant.userGender)}\n\n${spokenRules(displayName)}`;
}

// Generic instructions for delivering a proactive greeting as one spoken
// monologue. Used by both the bundled example and any custom greeting prompt.
function greetingShape(gender: UserGender): string {
  return `This is the first time the operator has spoken to you today. Before they even ask, deliver a proactive spoken briefing.

Deliver it as ONE flowing monologue, in character: a brief greeting, then the most important status points (lead with what's going well), then one or two things that need attention, then two or three concrete prioritised suggestions for what to work on today, phrased as recommendations ("I'd suggest we…", "My recommendation${vocative(gender)}…").

Keep it tight and conversational — spoken aloud, so no lists, no markdown, no reading raw tables. Round numbers naturally. Aim for about thirty to forty-five seconds of speech. Be confident and a touch witty, never robotic.`;
}

// The bundled example profile. Demonstrates the briefing capability out of the
// box with real numbers, referring to the product generically as "your app".
function exampleGreeting(gender: UserGender): string {
  return `${greetingShape(gender)}

You are briefing the operator on their app. Refer to it generically as "your app" — do not invent or use a brand name.

Here are the metrics you are working from. Use them for accuracy but speak them naturally — do not recite every figure:

${BRIEFING_FACTS}`;
}

export interface PromptInputs {
  config: OpenDexConfig;
  briefing: boolean;
  /** Operating-instruction addenda from enabled skills (non-briefing turns).
   *  Each skill declares its own via `Skill.systemPrompt` — see src/skills. */
  skillPrompts?: string[];
}

/** Resolve the system prompt for a turn, honouring the configured persona and
 *  greeting mode, plus any enabled-skill operating instructions. */
export function buildSystemPrompt({
  config,
  briefing,
  skillPrompts = [],
}: PromptInputs): string {
  const persona = buildPersona(config);
  const gender = config.assistant.userGender;

  if (!briefing) {
    // Append each enabled skill's operating manual (e.g. computer-use).
    return [persona, ...skillPrompts].join("\n\n---\n\n");
  }

  if (config.greeting.mode === "none") return persona;

  if (config.greeting.mode === "custom") {
    const custom = config.greeting.customPrompt.trim();
    const body = custom || greetingShape(gender);
    return `${persona}\n\n---\n\n${body}`;
  }

  // "example"
  return `${persona}\n\n---\n\n${exampleGreeting(gender)}`;
}

// Extra rules for realtime speech-to-speech sessions. Latency punishes rambling
// harder than TTS does, tool calls happen live mid-conversation, and heavy work
// is delegated to the pipeline agent via run_task with spoken progress updates.
const REALTIME_ADDENDUM = `You are speaking live over a realtime voice connection.

- Be extra brief. One or two sentences is the norm; only go longer when the user asks for detail.
- When the user's intent is clear, call tools immediately without asking for confirmation.
- For anything that involves looking at the screen, operating apps or files, or multi-step desktop work, call run_task with complete, self-contained instructions — do not attempt it yourself.
- While a delegated task runs you will receive notes prefixed "[task progress]" or "[task action]". When asked to respond mid-task, give ONE short sentence about what concretely changed since your last update — name the specific thing ("Found the invoice, filling in the amounts now."). Never say generic filler like "still working on it", and never read the notes verbatim.
- When a tool returns a result, summarise the outcome in a sentence or two.
- If a tool reports the user denied permission, say so and move on — do not retry.`;

export interface RealtimePromptInputs {
  config: OpenDexConfig;
  /** Whether this session should open with the proactive greeting (first wake
   *  of the app lifetime, greeting enabled). */
  briefing: boolean;
  /** Operating instructions from the skills exposed DIRECTLY to the session
   *  (non-image skills). Delegated skills' manuals reach the pipeline
   *  sub-agent through the normal chat path instead. */
  skillPrompts?: string[];
}

/** Session instructions for a realtime speech-to-speech connection: the same
 *  persona as the pipeline, the direct skills' manuals, realtime-specific
 *  rules, and — when this session opens with a greeting — the briefing brief. */
export function buildRealtimeInstructions({
  config,
  briefing,
  skillPrompts = [],
}: RealtimePromptInputs): string {
  const parts = [buildPersona(config), ...skillPrompts, REALTIME_ADDENDUM];
  const gender = config.assistant.userGender;

  if (briefing && config.greeting.mode !== "none") {
    const custom = config.greeting.customPrompt.trim();
    parts.push(
      config.greeting.mode === "custom" && custom ? custom : exampleGreeting(gender),
    );
  }

  return parts.join("\n\n---\n\n");
}

/** Whether a proactive greeting should fire on first wake (drives the renderer). */
export function greetingEnabled(config: OpenDexConfig): boolean {
  if (config.greeting.mode === "none") return false;
  if (config.greeting.mode === "custom") {
    return config.greeting.customPrompt.trim().length > 0;
  }
  return true;
}
