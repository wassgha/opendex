import { useEffect, useState } from "react";
import type { RecordingState } from "../../../../main/recordings/types";

export function useRecordingState() {
  const [state, setState] = useState<RecordingState>({ phase: "idle" });
  useEffect(() => {
    let live = true, changed = false;
    const off = window.opendex.onRecordingState(value => { changed = true; setState(value); });
    void window.opendex.recordingState().then(value => { if (live && !changed) setState(value); }).catch(console.error);
    return () => { live = false; off(); };
  }, []);
  return state;
}
