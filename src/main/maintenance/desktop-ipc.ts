import { connect, type Socket } from "node:net";
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
const MAX_FRAME = 8 * 1024 * 1024;
export const TESTED_DESKTOP = { version: "26.901.51231", build: "8109" };
const versions = { "thread-owner-discovery": 1, "thread-follower-start-turn": 2, "thread-follower-steer-turn": 1 } as const;
type Method = keyof typeof versions;
type Frame = Record<string, any>;

export class DesktopBridgeError extends Error {
  constructor(public readonly code: "unavailable" | "unsupported" | "timeout" | "protocol" | "rejected", message: string) { super(message); }
}

export function codexHome() { return process.env.CODEX_HOME || join(homedir(), ".codex"); }

/** Experimental adapter for the installed desktop follower protocol. Never
 * connects to its protected native tool pipe or impersonates another client. */
export async function desktopEndpoint() {
  if (process.platform !== "darwin") throw new DesktopBridgeError("unsupported", "The desktop adapter currently supports macOS only.");
  let supported = false;
  for (const bundle of ["/Applications/ChatGPT.app", "/Applications/Codex.app"]) {
    try {
      const plist = join(bundle, "Contents/Info.plist");
      const [{ stdout: version }, { stdout: build }] = await Promise.all([
        exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist], { timeout: 2000 }),
        exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", plist], { timeout: 2000 }),
      ]);
      if (version.trim() === TESTED_DESKTOP.version && build.trim() === TESTED_DESKTOP.build) { supported = true; break; }
    } catch { /* try the other normal installation */ }
  }
  if (!supported) throw new DesktopBridgeError("unsupported", "This desktop app version has not been validated for the Dex bridge. The adapter needs a compatibility check.");
  const path = join(codexHome(), "ipc/ipc.sock");
  try {
    const [parent, socket] = await Promise.all([lstat(dirname(path)), lstat(path)]);
    const uid = process.getuid?.();
    if (uid === undefined || !parent.isDirectory() || !socket.isSocket() || parent.uid !== uid || socket.uid !== uid || (parent.mode & 0o022) !== 0 || (socket.mode & 0o022) !== 0) {
      throw new Error("Invalid socket ownership");
    }
  } catch { throw new DesktopBridgeError("unavailable", "The local desktop connection is unavailable or is not owned securely by this user. Open the Codex desktop app."); }
  return path;
}

export class DesktopConnection {
  private buffer = Buffer.alloc(0);
  private clientId = "opendex-initializing";
  private failure?: Error;
  private pending = new Map<string, { resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; owner?: string }>();
  private snapshots = new Set<{ taskId: string; owner: string; resolve: (state: Frame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private following = new Map<string, string>();
  private constructor(private socket: Socket, private timeoutMs: number) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("error", () => this.fail(new DesktopBridgeError("unavailable", "The desktop connection failed.")));
    socket.on("close", () => this.fail(new DesktopBridgeError("unavailable", "The desktop connection closed.")));
  }
  static async open(path?: string, timeoutMs = 5000) {
    const socket = connect(path ?? await desktopEndpoint());
    const client = new DesktopConnection(socket, timeoutMs);
    try {
      const response = await client.sendRequest("initialize", { clientType: "opendex" }, 0);
      if (typeof response.result?.clientId !== "string") throw new DesktopBridgeError("protocol", "Desktop initialization returned an unsupported response.");
      client.clientId = response.result.clientId;
      return client;
    } catch (error) { client.close(); throw error; }
  }
  private send(frame: Frame) {
    if (this.failure) throw this.failure;
    const payload = Buffer.from(JSON.stringify(frame));
    if (payload.length > MAX_FRAME) throw new DesktopBridgeError("protocol", "The desktop request exceeds its size limit.");
    const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }
  private consume(chunk: Buffer) {
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (!length || length > MAX_FRAME) { this.fail(new DesktopBridgeError("protocol", "The desktop response exceeds the supported frame limit.")); return; }
      if (this.buffer.length < length + 4) return;
      const bytes = this.buffer.subarray(4, length + 4); this.buffer = this.buffer.subarray(length + 4);
      try {
        const frame = JSON.parse(bytes.toString("utf8"));
        if (!frame || typeof frame !== "object") throw new Error("Invalid frame");
        this.receive(frame);
      } catch { this.fail(new DesktopBridgeError("protocol", "The desktop sent an unsupported message.")); return; }
    }
  }
  private receive(frame: Frame) {
    if (frame.type === "client-discovery-request") {
      this.send({ type: "client-discovery-response", requestId: frame.requestId, response: { canHandle: false } }); return;
    }
    if (frame.type === "request") {
      this.send({ type: "response", requestId: frame.requestId, resultType: "error", error: "no-handler-for-request" }); return;
    }
    if (frame.type === "response") {
      const entry = this.pending.get(frame.requestId); if (!entry) return;
      this.pending.delete(frame.requestId); clearTimeout(entry.timer);
      if (entry.owner && frame.handledByClientId !== entry.owner) entry.reject(new DesktopBridgeError("protocol", "The desktop response did not come from the selected task owner."));
      else if (frame.resultType === "success") entry.resolve(frame);
      else entry.reject(new DesktopBridgeError(frame.error === "no-client-found" ? "unavailable" : "rejected",
        frame.error === "no-client-found" ? "This task is not currently owned by an available desktop window. Open the task in Codex first." : "The desktop rejected the request. Inspect the task before trying again."));
      return;
    }
    if (frame.type !== "broadcast" || frame.method !== "thread-stream-state-changed" || frame.version !== 11 || frame.params?.hostId !== "local" || frame.params?.change?.type !== "snapshot") return;
    for (const entry of this.snapshots) {
      if (frame.sourceClientId !== entry.owner || frame.params.conversationId !== entry.taskId || frame.params.change.conversationState?.id !== entry.taskId) continue;
      clearTimeout(entry.timer); this.snapshots.delete(entry); entry.resolve(frame.params.change.conversationState);
    }
  }
  private sendRequest(method: string, params: unknown, version: number, targetClientId?: string): Promise<Frame> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopBridgeError("timeout", "The desktop did not confirm the request in time. A submitted message may still have arrived; do not resend automatically."));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, owner: targetClientId });
      try { this.send({ type: "request", requestId, method, params, version, sourceClientId: this.clientId, targetClientId, timeoutMs: this.timeoutMs - 100 }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  request(method: Method, params: unknown, owner?: string) { return this.sendRequest(method, params, versions[method], owner); }
  /** Notify desktop caches only after the archive API has acknowledged success. */
  archived(taskId: string, cwd: string) {
    this.send({ type: "broadcast", method: "thread-archived", version: 2,
      sourceClientId: this.clientId, params: { hostId: "local", conversationId: taskId, cwd } });
  }
  async owner(taskId: string) {
    const response = await this.request("thread-owner-discovery", { hostId: "local", conversationId: taskId });
    if (typeof response.handledByClientId !== "string") throw new DesktopBridgeError("protocol", "The desktop did not identify the task owner.");
    return response.handledByClientId;
  }
  private follow(taskId: string, owner: string, following: boolean) {
    this.send({ type: "broadcast", method: "thread-stream-following-changed", sourceClientId: this.clientId, targetClientIds: [owner], version: 1,
      params: { hostId: "local", conversationId: taskId, following } });
  }
  snapshot(taskId: string, owner: string): Promise<Frame> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const entry = { taskId, owner, resolve, reject, timer: setTimeout(() => {
        this.snapshots.delete(entry); reject(new DesktopBridgeError("timeout", "The desktop did not provide a fresh task snapshot."));
      }, this.timeoutMs) };
      this.snapshots.add(entry);
      try {
        if (this.following.has(taskId)) this.follow(taskId, owner, false);
        this.following.set(taskId, owner); this.follow(taskId, owner, true);
      } catch (error) { clearTimeout(entry.timer); this.snapshots.delete(entry); reject(error); }
    });
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    for (const p of this.snapshots) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.snapshots.clear(); this.buffer = Buffer.alloc(0); this.socket.destroy();
  }
  close() {
    if (!this.failure) for (const [id, owner] of this.following) { try { this.follow(id, owner, false); } catch { /* connection already gone */ } }
    this.fail(new DesktopBridgeError("unavailable", "Desktop inspection ended."));
  }
}
