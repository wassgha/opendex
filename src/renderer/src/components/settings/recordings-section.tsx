import { useEffect, useState } from "react";
import { Circle, Download, FolderOpen, Square, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { recordingPreferences, saveRecordingPreferences } from "@/lib/recordings/preferences";
import { interactionRecorder } from "@/lib/recordings/recorder";
import { useRecordingState } from "@/lib/recordings/use-recording-state";
import type { RecordingEntry, RecordingSource } from "../../../../main/recordings/types";

const duration = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function RecordingsSection() {
  const state = useRecordingState();
  const [sources, setSources] = useState<RecordingSource[]>([]);
  const [sourceId, setSourceId] = useState(() => recordingPreferences().sourceId);
  const [mic, setMic] = useState(() => recordingPreferences().microphone);
  const [systemAudio, setSystemAudio] = useState(() => recordingPreferences().systemAudio);
  const [clips, setClips] = useState<RecordingEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { saveRecordingPreferences({ sourceId, microphone: mic, systemAudio }); }, [sourceId, mic, systemAudio]);
  const active = state.phase !== "idle";
  const refresh = async () => { setClips(await window.opendex.recordingList()); };
  const loadSources = async () => {
    const list = await window.opendex.recordingSources();
    setSources(list); setSourceId(current => list.some(source => source.id === current) ? current : list[0]?.id ?? "");
  };
  useEffect(() => {
    void Promise.all([loadSources(), refresh()]).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (!active) void refresh().catch(e => setError(String(e))); }, [active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const act = async (action: () => Promise<unknown>) => {
    setWorking(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  };
  const clip = clips.find(item => item.id === selected);
  return <>
    <p className="text-sm text-muted-foreground">Capture a full interaction to watch later or export as a demo. Start here, from the notch, or by saying “Dex, start recording.” The notch and voice use these screen and audio options.</p>
    <div className="space-y-4 border-b border-border pb-5">
      <label className="block space-y-1.5 text-sm font-medium">
        <span>Screen to record</span>
        <select value={sourceId} disabled={active || working} onChange={e => setSourceId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {!sources.length && <option value="">No screens available</option>}
          {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      {!sources.length && <Button variant="outline" disabled={active || working} onClick={() => void act(loadSources)}>Check screens again</Button>}
      <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={mic} disabled={active || working} onChange={e => setMic(e.target.checked)} />Microphone</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={systemAudio} disabled={active || working} onChange={e => setSystemAudio(e.target.checked)} />System audio, including Dex</label>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">Everything visible on this screen is captured, including notifications. System audio includes other apps. Files stay on this computer; export does not publish them. Each recording stops at thirty minutes or two gigabytes.</p>
      <div className="flex flex-wrap items-center gap-3">
        {active ? <Button variant="destructive" disabled={state.phase === "saving"} onClick={() => interactionRecorder.stop()}><Square />{state.phase === "saving" ? "Saving…" : "Stop recording"}</Button> : <Button disabled={working || !sourceId} onClick={() => void act(() => interactionRecorder.start({ sourceId, microphone: mic, systemAudio }))}><Circle />{working ? "Starting…" : "Start recording"}</Button>}
        <span role="status" className="text-sm text-muted-foreground">{state.phase === "recording" ? `Recording · ${duration(Math.max(0, now - (state.startedAt ?? now)))}` : state.phase === "starting" ? "Preparing screen and audio…" : state.phase === "saving" ? "Finishing your video…" : notice}</span>
      </div>
      {active && <p className="text-xs text-muted-foreground">You can close Settings and keep recording. Stop from the notch, by voice, or from the OpenDex tray menu.</p>}
      {(error || state.error) && <p role="alert" className="text-sm text-destructive">{error || state.error}</p>}
    </div>
    {clip && <div className="space-y-2">
      <video key={clip.id} controls preload="metadata" aria-label={clip.title} className="aspect-video w-full rounded-lg bg-muted" src={`opendex-recording://video/${clip.id}`} onError={() => setError("This video could not be played. Interrupted recordings may be incomplete; try exporting or opening the file.")} />
      <p className="text-xs text-muted-foreground">{clip.title}</p>
    </div>}
    <h3 className="text-sm font-semibold">Saved recordings</h3>
    {loading ? <p className="text-sm text-muted-foreground" role="status">Loading recordings…</p> : !clips.length ? <p className="text-sm text-muted-foreground">Your first video will appear here when you stop recording.</p> : <ul className="divide-y divide-border">
      {clips.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <button type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(""); }} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block text-sm font-medium">{new Date(item.createdAt).toLocaleString()}</span>
          <span className="block text-xs text-muted-foreground">{duration(item.durationMs)} · {(item.bytes / 1024 / 1024).toFixed(1)} MB · {item.extension.toUpperCase()}{item.status === "interrupted" ? " · Interrupted" : ""}</span>
          <span className="block text-xs text-muted-foreground">{[item.microphone ? "Microphone" : "", item.systemAudio ? "System audio" : ""].filter(Boolean).join(" + ") || "Video only"}</span>
        </button>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={working} onClick={() => void act(async () => { if (await window.opendex.recordingExport(item.id)) setNotice("Recording exported."); })}><Download />Export</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Show recording file" disabled={working} onClick={() => void act(() => window.opendex.recordingReveal(item.id))}><FolderOpen /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Move recording to Trash" disabled={working} onClick={() => void act(async () => { if (selected === item.id) setSelected(null); await window.opendex.recordingTrash(item.id); await refresh(); setNotice("Recording moved to Trash."); })}><Trash2 /></Button>
        </div>
      </li>)}
    </ul>}
  </>;
}
