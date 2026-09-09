import type { KaldiRecognizer, Model } from "vosk-browser";

/** Local display only. Never submit this estimate as a command or model context. */
export class InputPreview {
  private recognizer: KaldiRecognizer | null = null;
  private model: Model | null = null;
  private closed = false;
  private parts = "";
  private shown = "";
  constructor(private publish: (text: string) => void,
    private loadModel: () => Promise<Model> = async () => {
      const { loadVoskModel } = await import("../engines/vosk-model");
      return loadVoskModel();
    }) {}

  async start(): Promise<void> {
    const model = await this.loadModel();
    if (this.closed) return;
    this.model = model;
    this.reset();
  }

  reset(): void {
    const previous = this.recognizer;
    this.recognizer = null;
    try { previous?.remove(); } catch { /* A failed preview must not stop audio. */ }
    this.parts = "";
    this.show("");
    if (this.closed || !this.model) return;
    let rec: KaldiRecognizer;
    try { rec = new this.model.KaldiRecognizer(16000); }
    catch { this.closed = true; this.model = null; return; }
    this.recognizer = rec;
    rec.on("partialresult", message => {
      if (this.recognizer !== rec) return;
      this.show(`${this.parts} ${message.result?.partial ?? ""}`.trim());
    });
    rec.on("result", message => {
      if (this.recognizer !== rec) return;
      this.parts = `${this.parts} ${message.result?.text ?? ""}`.trim().slice(-4000);
      this.show(this.parts);
    });
  }

  feed(frame: Float32Array): void {
    // Vosk transfers its buffer to the worker; never detach the shared mic frame.
    try { this.recognizer?.acceptWaveformFloat(frame.slice(), 16000); }
    catch { this.close(); }
  }
  close(): void { this.closed = true; this.reset(); this.model = null; }
  private show(text: string): void {
    text = text.slice(-4000);
    if (text === this.shown) return;
    this.shown = text;
    this.publish(text);
  }
}
