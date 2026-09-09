/** Browser capture prompts cannot be aborted; dispose any stream arriving late. */
export function acquireCapture(pending: Promise<MediaStream>, signal: AbortSignal, label: string, timeoutMs = 30000): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = (message: string) => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error(message));
    };
    const abort = () => fail("Recording cancelled.");
    const timer = setTimeout(() => fail(`${label} did not start within thirty seconds. Check its system permission, then try again.`), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(stream => {
      if (settled) { stream.getTracks().forEach(track => track.stop()); return; }
      settled = true; cleanup(); resolve(stream);
    }, error => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    });
    if (signal.aborted) abort();
  });
}
