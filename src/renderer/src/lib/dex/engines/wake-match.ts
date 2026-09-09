type RecognizedWord = { word: string; conf: number; start: number; end: number };

/** Match completed recognition only; partial hypotheses are unstable. */
export function matchesWakeResult(words: RecognizedWord[] | undefined, wakeWord: string): boolean {
  return wakeCommandFromResult(words, wakeWord) !== null;
}

/** null means no wake; empty text means the wake word was spoken alone. */
export function wakeCommandFromResult(words: RecognizedWord[] | undefined, wakeWord: string): string | null {
  const normalized = wakeWord.trim().toLowerCase() || "computer";
  // Observed live recognition spells this name as dex or dax; decks is its
  // common-word homophone. Keep aliases exclusive to the default name.
  const phrases = normalized === "dex" ? ["dex", "decks", "dax"] : [normalized];
  for (const phrase of phrases) {
    const tokens = phrase.split(/\s+/);
    const all = words ?? [];
    const index = all.findIndex((_, index) =>
      // Direct address only: don't wake on a name buried in background speech.
      (index === 0 || (index === 1 && ["hey", "okay", "ok"].includes(all[0].word.toLowerCase()))) &&
      tokens.every((token, offset) => {
        const word = all[index + offset];
        // Proper-name confidence varied from .49 to 1 in live attempts. The
        // completed, unrestricted recognizer and direct-address position are
        // the gate; a confidence cutoff rejects correctly recognized speech.
        return word?.word.toLowerCase() === token && Number.isFinite(word.conf) &&
          Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start;
      }),
    );
    if (index !== -1) return all.slice(index + tokens.length).map((word) => word.word).join(" ").trim();
  }
  return null;
}
