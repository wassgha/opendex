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

// Operating manual injected when the computer-control skill is active, so the
// model drives the screenshot → act → screenshot loop correctly.
function computerUseGuidance(gender: UserGender): string {
  const v = vocative(gender);
  const platform =
    process.platform === "darwin"
      ? "macOS (use the Cmd key for shortcuts, not Ctrl)"
      : process.platform === "win32"
        ? "Windows (use the Ctrl key for shortcuts)"
        : "Linux (use the Ctrl key for shortcuts)";
  return `You can see and control this computer. The operating system is ${platform}.

To operate it: first call captureScreen to see the screen, then act with click, moveMouse, typeText, pressKeys, and scroll. Coordinates are in the pixel space of the most recent screenshot, with (0,0) at the top-left.

Don't take a screenshot after every action — it's slow. typeText and pressKeys return no screenshot by default, so chain related keystrokes (e.g. type a field, press Tab, type the next, press Enter) without looking in between. click and scroll do return a screenshot since they change what's on screen. When you want to verify the result of a keystroke sequence, either pass screenshot:true on the last action or call captureScreen. After you see a screenshot, confirm the effect before continuing, and re-screenshot if you're unsure.

Keep spoken narration light — the user is watching the screen and sees a live list of every action, so don't give a play-by-play of each click or keystroke. Say a short sentence when you begin (e.g. "On it${v}."), then offer a brief progress note every few actions as you move between phases of the task (a quick "Opening the browser now", "Filling in the details") so it's clear you're still working, and finish with one short summary of the outcome.

Work in small, deliberate steps and stop once the task is done or if something looks wrong. If a screenshot is empty or a click has no effect, the operator may need to grant Screen Recording and Accessibility permissions in their system settings — say so rather than retrying blindly.`;
}

export interface PromptInputs {
  config: OpenDexConfig;
  briefing: boolean;
  /** Whether the computer-control skill is active this turn. */
  computerUse?: boolean;
}

/** Resolve the system prompt for a turn, honouring the configured persona and
 *  greeting mode. */
export function buildSystemPrompt({ config, briefing, computerUse }: PromptInputs): string {
  const persona = buildPersona(config);
  const gender = config.assistant.userGender;
  const base =
    computerUse && !briefing
      ? `${persona}\n\n---\n\n${computerUseGuidance(gender)}`
      : persona;
  if (!briefing || config.greeting.mode === "none") return base;

  if (config.greeting.mode === "custom") {
    const custom = config.greeting.customPrompt.trim();
    const body = custom || greetingShape(gender);
    return `${persona}\n\n---\n\n${body}`;
  }

  // "example"
  return `${persona}\n\n---\n\n${exampleGreeting(gender)}`;
}

/** Whether a proactive greeting should fire on first wake (drives the renderer). */
export function greetingEnabled(config: OpenDexConfig): boolean {
  if (config.greeting.mode === "none") return false;
  if (config.greeting.mode === "custom") {
    return config.greeting.customPrompt.trim().length > 0;
  }
  return true;
}
