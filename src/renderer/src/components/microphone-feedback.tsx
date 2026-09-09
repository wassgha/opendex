import { useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { awarenessLabel, type DexStatus } from "@/lib/dex/state";

/** The main window samples its existing mic; the notch receives scalar levels.
 * No extra microphone capture, recorded audio, or synthetic speaking envelope. */
function useMicrophoneSample(getLevel?: () => number | null) {
  const [sample, setSample] = useState<{ level: number | null; history: number[] }>({ level: null, history: Array(20).fill(0) });
  useEffect(() => {
    let lastSample = Date.now();
    const update = (level: number | null) => {
      lastSample = Date.now();
      setSample(previous => ({ level, history: level === null ? Array(20).fill(0) : [...previous.history.slice(1), level] }));
    };
    if (getLevel) {
      update(getLevel());
      const timer = setInterval(() => update(getLevel()), 80);
      return () => clearInterval(timer);
    }
    const off = window.opendex.onMicrophoneLevel(update);
    const watchdog = setInterval(() => { if (Date.now() - lastSample > 500) update(null); }, 250);
    return () => { off(); clearInterval(watchdog); };
  }, [getLevel]);
  return sample;
}

/** Compact microphone artwork for the notch's existing mute button. */
export function MicrophoneVisual({ status, isMuted }: { status: DexStatus; isMuted: boolean }) {
  const sample = useMicrophoneSample();
  const available = !isMuted && sample.level !== null;
  const awake = !isMuted && ["active_listening", "follow_up_listening", "thinking", "speaking"].includes(status);
  // AudioMeter already scales speech RMS. A second square-root boost made
  // quiet keyboard clicks look disproportionately loud. Keep this linear;
  // visual sensitivity must never gate the audio sent to recognition.
  const level = available ? sample.level ?? 0 : 0;
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 28 28" className="pointer-events-none absolute inset-0 size-7! overflow-visible" fill="none">
        <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="1.5" opacity={awake ? 0.35 : 0.12} />
        <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" pathLength="1"
          strokeDasharray={`${level} 1`} strokeLinecap="round" opacity={level > 0.01 ? 0.9 : 0}
          transform="rotate(-90 14 14)" />
      </svg>
      {isMuted ? <MicOff className="size-3.5!" /> : <Mic className="size-3.5!" />}
    </span>
  );
}

export function MicrophoneFeedback({ status, wakeWord, getLevel, feedback }: {
  feedback?: string;
  status: DexStatus;
  wakeWord?: string;
  getLevel?: () => number | null;
}) {
  const sample = useMicrophoneSample(getLevel);
  const available = status !== "muted" && sample.level !== null;
  return (
    <div className="flex min-h-8 shrink-0 items-center justify-center gap-3 px-3 py-1 text-[11px] text-foreground">
      <span role="status" className="min-w-0 font-medium" title={feedback || awarenessLabel(status, wakeWord)}>{feedback || awarenessLabel(status, wakeWord)}</span>
      <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground" title="Live microphone input level, not a transcription. Voice engines may filter or ignore this audio.">
        {available ? <Mic className="size-3" aria-hidden /> : <MicOff className="size-3" aria-hidden />}
        <span className="sr-only">{available ? "Microphone input active" : "Microphone input unavailable"}</span>
        <div role="img" aria-label={available ? "Live microphone input level" : "No microphone input"} className="flex h-4 w-[59px] items-center gap-px">
          {sample.history.map((level, index) => (
            <span key={index} className="w-0.5 rounded-full bg-current" style={{ height: available ? Math.max(2, level * 16) : 2, opacity: available ? 0.85 : 0.25 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
