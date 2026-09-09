/** Deliberately narrow: mixed requests and explicit cancellation remain steering. */
export function isDesktopStatusQuestion(text: string, wakeWord = 'Dex'): boolean {
  let words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wake = wakeWord.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const prefix of [`hey ${wake} `, `${wake} `]) if (wake && words.startsWith(prefix)) { words = words.slice(prefix.length); break; }
  words = words.replace(/^(?:no )?i (?:am|m) asking /, '');
  return /^(?:what are you doing|what s happening|what is happening|what s going on|what is going on|what s wrong|what is wrong|what went wrong|was wrong|that was wrong|something is wrong|are you still working|are you done|how s it going|how is it going|what s the status|what is the status|any update|any updates|status update|give me an update|why is it taking so long)$/.test(words);
}

/** Tool names only: never include user input, screen text or invented findings. */
export function desktopProgress(tool: string, failed = false): string {
  if (failed) return 'The last desktop action reported a problem. I’m checking how to proceed; the task is still incomplete.';
  if (['captureScreen', 'zoomScreen', 'captureDisplay'].includes(tool)) return 'I have a screen image and am examining it for the next step. The task is still running.';
  if (tool === 'openUrl') return 'The browser navigation request finished. I’m checking the page; the task is still running.';
  if (['click', 'scroll', 'pressKeys', 'typeText', 'wait'].includes(tool)) return 'The last browser action finished. I’m checking the resulting screen before continuing.';
  return 'The last tool action finished. I’m working on the next step; the task is not complete yet.';
}
