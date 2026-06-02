import { createModel, type Model } from "vosk-browser";

// Default Vosk small-English model (~50MB), downloaded + unzipped in a worker on
// first use. Hosted by the vosk-browser project; cached by the browser after.
export const DEFAULT_VOSK_MODEL_URL =
  "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";

let modelPromise: Promise<Model> | null = null;
let loadedUrl = "";

export function loadVoskModel(url: string = DEFAULT_VOSK_MODEL_URL): Promise<Model> {
  if (!modelPromise || loadedUrl !== url) {
    loadedUrl = url;
    modelPromise = createModel(url).catch((err) => {
      modelPromise = null; // allow retry
      throw err;
    });
  }
  return modelPromise;
}

export function floatFromFrame(frame: Int16Array): Float32Array {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] / 32768;
  return out;
}
