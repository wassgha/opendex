// Buffers incoming LLM text and emits chunks at natural sentence boundaries
// so we can start synthesising speech before the full reply is ready.

const BOUNDARY = /([.!?][\s"”')\]]*|[\n\r]+)/;
const MIN_CHARS = 12; // don't emit something like "OK." instantly — let it grow a little
const SOFT_MAX = 240; // emit at this length even without a boundary

export interface SentenceBuffer {
  push(text: string): string[];
  flush(): string[];
}

export function createSentenceBuffer(): SentenceBuffer {
  let buf = "";

  function takeOne(): string | null {
    const m = buf.match(BOUNDARY);
    if (m && m.index !== undefined) {
      const end = m.index + m[0].length;
      const chunk = buf.slice(0, end).trim();
      if (chunk.length >= MIN_CHARS) {
        buf = buf.slice(end);
        return chunk;
      }
    }
    if (buf.length >= SOFT_MAX) {
      // split at last whitespace before SOFT_MAX so we don't sever words
      const slice = buf.slice(0, SOFT_MAX);
      const ws = slice.lastIndexOf(" ");
      const cut = ws > MIN_CHARS ? ws : SOFT_MAX;
      const chunk = buf.slice(0, cut).trim();
      buf = buf.slice(cut);
      return chunk;
    }
    return null;
  }

  return {
    push(text) {
      buf += text;
      const out: string[] = [];
      while (true) {
        const chunk = takeOne();
        if (!chunk) break;
        out.push(chunk);
      }
      return out;
    },
    flush() {
      const remaining = buf.trim();
      buf = "";
      return remaining ? [remaining] : [];
    },
  };
}
