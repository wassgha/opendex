import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, stat, rename, appendFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { MAX_RECORDING_BYTES, RECORDING_MIMES, type RecordingEntry, type RecordingOptions } from "./types";

export class RecordingStore {
  private active: RecordingEntry | null = null;
  private writes: Promise<void> = Promise.resolve();
  private writeError: unknown;
  constructor(readonly directory: string) {}

  private metadataPath(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid recording ID.");
    return join(this.directory, `${id}.json`);
  }
  async get(id: string): Promise<RecordingEntry> {
    const entry = JSON.parse(await readFile(this.metadataPath(id), "utf8")) as RecordingEntry;
    if (entry.id !== id || !["mp4", "webm"].includes(entry.extension)) throw new Error("Invalid recording metadata.");
    return entry;
  }
  mediaPath(entry: RecordingEntry) {
    this.metadataPath(entry.id);
    if (!["mp4", "webm"].includes(entry.extension)) throw new Error("Invalid recording format.");
    return join(this.directory, `${entry.id}.${entry.extension}`);
  }
  private async save(entry: RecordingEntry) {
    const path = this.metadataPath(entry.id);
    await writeFile(`${path}.tmp`, JSON.stringify(entry), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async begin(options: RecordingOptions, mimeType: string) {
    if (this.active) throw new Error("A recording is already active.");
    if (!(RECORDING_MIMES as readonly string[]).includes(mimeType)) throw new Error("Unsupported recording format.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const createdAt = Date.now();
    const entry: RecordingEntry = {
      id: randomUUID(), title: `Dex interaction ${new Date(createdAt).toLocaleString()}`,
      createdAt, durationMs: 0, bytes: 0, mimeType,
      extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
      status: "interrupted", microphone: options.microphone, systemAudio: options.systemAudio,
    };
    await writeFile(this.mediaPath(entry), new Uint8Array(), { flag: "wx", mode: 0o600 });
    await this.save(entry); // An unclean quit leaves a discoverable interrupted clip.
    this.active = entry;
    this.writes = Promise.resolve();
    this.writeError = undefined;
    return entry;
  }
  append(id: string, data: ArrayBuffer) {
    const entry = this.active;
    if (!entry || entry.id !== id) return Promise.reject(new Error("Recording is no longer active."));
    if (!(data instanceof ArrayBuffer) || data.byteLength > 8 * 1024 * 1024) return Promise.reject(new Error("Invalid recording chunk."));
    if (entry.bytes + data.byteLength > MAX_RECORDING_BYTES) return Promise.reject(new Error("Recording reached the two-gigabyte limit."));
    entry.bytes += data.byteLength;
    const next = this.writes.then(async () => {
      if (this.writeError) throw this.writeError;
      await appendFile(this.mediaPath(entry), new Uint8Array(data));
    });
    this.writes = next.catch(error => { this.writeError = error; });
    return next;
  }
  async finish(id: string, durationMs: number, interrupted = false) {
    if (!this.active || this.active.id !== id) throw new Error("Recording is no longer active.");
    const entry = this.active;
    await this.writes;
    try {
      entry.bytes = (await stat(this.mediaPath(entry))).size;
      entry.durationMs = Number.isFinite(durationMs) ? Math.max(0, Math.min(durationMs, Date.now() - entry.createdAt)) : 0;
      entry.status = interrupted || this.writeError ? "interrupted" : "complete";
      if (!entry.bytes) {
        await unlink(this.mediaPath(entry));
        await unlink(this.metadataPath(id));
      } else await this.save(entry);
      return entry;
    } finally { this.active = null; }
  }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await Promise.all((await readdir(this.directory)).filter(n => n.endsWith(".json")).map(async name => {
      try {
        const entry = await this.get(name.slice(0, -5));
        if (entry.id === this.active?.id) return null;
        entry.bytes = (await stat(this.mediaPath(entry))).size;
        return entry.bytes ? entry : null;
      } catch { return null; }
    }));
    return entries.filter((e): e is RecordingEntry => e !== null).sort((a, b) => b.createdAt - a.createdAt);
  }
  async trash(id: string, moveToTrash: (path: string) => Promise<void>) {
    if (id === this.active?.id) throw new Error("Stop the recording before removing it.");
    await moveToTrash(this.mediaPath(await this.get(id)));
    await moveToTrash(this.metadataPath(id));
  }
}
