/** During speaker playback, speech probability cannot distinguish the user from
 * residual echo. Require addressed steering; always retain explicit stop commands.
 * After playback/echo-tail, normal conversation remains wake-word free. */
export function isDirectedPlaybackTurn(text: string, wakeWord: string): boolean {
  const words = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wake = wakeWord.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (wake && (` ${words} `).includes(` ${wake} `)) return true;
  if (/^(?:please )?(?:stop|cancel|pause|wait)(?: |$)/.test(words)) return true;
  return /^(?:please )?(?:go to sleep|be quiet)(?: please)?$/.test(words);
}
