import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { WalkthroughView } from "./walkthrough-document";
import { openWalkthroughLocation } from "./walkthrough-editor";

/** Curated tour, not an unrestricted filesystem reader or semantic language server. */
export const WALKTHROUGH_ENTRIES = [
  { id: "command", title: "Main command handler", file: "src/main/index.ts", anchor: "ipcMain.on(IPC.chatStart", summary: "Receives renderer chat requests, resolves the model and wires the permission-gated tools." },
  { id: "tools", title: "Tool wiring", file: "src/skills/registry.ts", anchor: "export function buildToolSet", summary: "Assembles enabled skills and checks permissions before sensitive tool execution." },
  { id: "agent", title: "Agent loop", file: "src/main/agent/chat.ts", anchor: "export async function streamChat", summary: "Streams the model reply and runs its tool loop." },
  { id: "voice", title: "Voice state machine", file: "src/renderer/src/lib/dex/use-dex.ts", anchor: "export function useDex", summary: "Coordinates listening, thinking, speech playback and interruption." },
  { id: "realtime", title: "Realtime session", file: "src/main/agent/realtime/session-host.ts", anchor: "", summary: "Hosts the speech-to-speech connection and direct tool execution in main." },
  { id: "bridge", title: "Renderer bridge", file: "src/preload/index.ts", anchor: "contextBridge.exposeInMainWorld", summary: "Exposes the typed IPC API to the renderer while keeping secrets in main." },
  { id: "config", title: "Configuration", file: "src/main/config/schema.ts", anchor: "export const DEFAULT_CONFIG", summary: "Defines preferences and defaults shared across the application." },
  { id: "walkthrough", title: "Code walkthrough", file: "src/skills/open/code-walkthrough.ts", anchor: "export class CodeWalkthrough", summary: "Maintains this tour and resolves bounded source locations for editor navigation." },
] as const;

export type WalkthroughInput = { action: "start" | "list" | "jump" | "next" | "end"; target?: string };
type Entry = typeof WALKTHROUGH_ENTRIES[number];
type Indexed = { entry: Entry; text: string; line: number; symbols: { name: string; line: number }[] };

const OVERVIEW = {
  title: "OpenDex architecture overview",
  summary: "OpenDex connects a voice interface to an agent that can use desktop tools. The renderer manages listening, conversation state and playback; a narrow preload bridge carries requests to the main process, where models, credentials and permission-gated skills live. Replies and tool progress flow back to the interface.",
  components: [
    { name: "Voice interface (renderer)", role: "Themes display the conversation while the voice state machine coordinates listening, thinking, playback and interruption." },
    { name: "Preload bridge", role: "A small typed IPC API connects the interface to main without exposing secrets." },
    { name: "Agent and voice services (main)", role: "Pipeline mode turns recognized speech into an agent reply and then speech playback. Realtime mode hosts a speech-to-speech connection in main and relays audio to and from the interface." },
    { name: "Skills and permissions (main)", role: "Enabled skills provide tools; sensitive actions pass through the existing permission gate before execution." },
    { name: "Configuration (main)", role: "Preferences select models, voice engines and skills; credentials stay in main." },
  ],
  flow: "User voice or text → renderer → preload IPC → main agent/voice services → permission-gated tools; replies, audio and progress → renderer → user.",
  message: "Explain this conceptual overview briefly, then wait for the user. Do not navigate to code automatically. When the user asks to dig deeper or says next, use next for the command handler, or jump for a requested entry or symbol. Questions about the overview do not advance the tour.",
};

export class CodeWalkthrough {
  private active = false;
  private current = -1;
  private generation = 0;
  constructor(private deps: {
    packaged: boolean; appPath: string;
    navigate?: (file: string, line: number) => Promise<string | null>;
    present?: (view: WalkthroughView, focus: boolean) => Promise<void>;
    dismiss?: () => void;
  }) {}

  private async index(): Promise<{ root: string; modules: Indexed[] }> {
    if (this.deps.packaged) throw new Error("Walkthrough requires the OpenDex development checkout; installed builds do not include source.");
    const root = await realpath(this.deps.appPath);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (pkg.name !== "opendex") throw new Error("The running app is not an OpenDex source checkout.");
    const modules: Indexed[] = [];
    for (const entry of WALKTHROUGH_ENTRIES) {
      const file = await realpath(join(root, entry.file));
      const rel = relative(root, file);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("A tour file resolves outside the source checkout.");
      const handle = await open(file, "r");
      let text: string;
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Tour source is not a regular file.");
        const buffer = Buffer.alloc(512 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 512 * 1024) throw new Error("Tour source exceeds the 512 KB read limit.");
        text = buffer.subarray(0, bytesRead).toString("utf8");
      } finally { await handle.close(); }
      const lines = text.split("\n");
      const anchor = entry.anchor ? lines.findIndex(line => line.includes(entry.anchor)) : 0;
      if (anchor < 0) throw new Error(`Tour anchor needs updating: ${entry.id}.`);
      const symbols = lines.flatMap((line, i) => {
        const match = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let)\s+([A-Za-z_$][\w$]*)/.exec(line);
        return match ? [{ name: match[1], line: i + 1 }] : [];
      }).slice(0, 80);
      modules.push({ entry, text, line: anchor + 1, symbols });
    }
    return { root, modules };
  }

  async run(input: WalkthroughInput, signal?: AbortSignal) {
    if (input.action === "end") {
      this.generation++; this.active = false; this.current = -1;
      this.deps.dismiss?.();
      return { ok: true, active: false, message: "Walkthrough ended. Editor files remain open." };
    }
    if (input.action !== "start" && !this.active) return { error: "Start a code walkthrough first." };
    const generation = ++this.generation;
    try {
      const { root, modules } = await this.index();
      const check = () => {
        signal?.throwIfAborted();
        if (generation !== this.generation) throw new Error("Walkthrough request superseded.");
      };
      check();
      const entries = modules.map(m => ({ ...m.entry, anchor: undefined, line: m.line, symbols: m.symbols }));
      if (input.action === "start") {
        await this.deps.present?.({ current: "overview", title: OVERVIEW.title, summary: OVERVIEW.summary, entries }, true);
        check();
        this.active = true; this.current = -1;
        return { ok: true, active: true, current: "overview", ...OVERVIEW, entries };
      }
      if (input.action === "list") return { ok: true, active: true, current: this.current === -1 ? "overview" : modules[this.current]?.entry.id, entries };
      let selected = 0;
      let line = modules[0].line;
      if (input.action === "next") {
        selected = this.current + 1;
        if (selected >= modules.length) return { ok: true, active: true, message: "End of tour. Ask a question, jump to an entry, or end the walkthrough." };
        line = modules[selected].line;
      }
      if (input.action === "jump") {
        const target = input.target?.trim().toLowerCase();
        if (!target) return { error: "Choose an entry ID, indexed file path, or exact symbol name." };
        const entryIndex = modules.findIndex(m => [m.entry.id, m.entry.title, m.entry.file].some(s => s.toLowerCase() === target));
        const matches = entryIndex >= 0 ? [{ i: entryIndex, line: modules[entryIndex].line }]
          : modules.flatMap((m, i) => m.symbols.filter(s => s.name.toLowerCase() === target).map(s => ({ i, line: s.line })));
        if (matches.length !== 1) return { error: matches.length ? "Ambiguous symbol; select an entry first by its ID." : "Target is not in the minimal index. Choose a listed entry or symbol.", entries };
        selected = matches[0].i; line = matches[0].line;
      }
      check();
      const module = modules[selected];
      const editor = await (this.deps.navigate ?? openWalkthroughLocation)(join(root, module.entry.file), line);
      check();
      if (!editor) return { error: "No supported editor CLI accepted navigation. Install VS Code, Cursor or Windsurf in /Applications on macOS, or expose its CLI on PATH on macOS/Linux. Windows navigation is not supported yet.", entries };
      const lines = module.text.split("\n");
      const sourceExcerpt = lines.slice(Math.max(0, line - 4), line + 36).map((s, i) => `${Math.max(1, line - 3) + i}: ${s}`).join("\n").slice(0, 8000);
      await this.deps.present?.({ current: module.entry.id, title: module.entry.title, summary: module.entry.summary, entries, file: module.entry.file, line, sourceExcerpt }, false);
      check();
      this.active = true; this.current = selected;
      return {
        ok: true, active: true, current: module.entry.id, file: module.entry.file, line, editor,
        summary: module.entry.summary,
        sourceExcerpt,
        verification: "Editor CLI accepted navigation; visible focus and selection are not independently verified.",
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Walkthrough failed." };
    }
  }
}
