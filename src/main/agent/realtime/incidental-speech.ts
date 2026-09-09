/** Ignore only isolated non-command vocalizations while an answer/task is busy.
 * Real short commands and yes/no answers must still reach the voice agent. */
export function isIncidentalSpeech(text: string, busy: boolean) {
  return busy && /^(?:h+m+|u+m+|u+h+|e+r+m+)[.!?,\s]*$/i.test(text.trim());
}

/** Acknowledgment during declarative playback or pending work is not a new request.
 * Keep this narrow: negatives, commands, question answers and idle speech pass.
 * Work includes pending tools after introductory playback has ended. */
export function isPlaybackAcknowledgment(text: string, workActive: boolean, assistantText: string) {
  if (!workActive || !assistantText.trim()) return false;
  if (!/^(?:yeah|yep|yes|okay|ok|right|m+h+m+|uh[ -]?huh)[.!?,\s]*$/i.test(text.trim())) return false;
  // Prefer accepting a possible answer to suppressing a user's authorization.
  const asksForReply = /\?|\b(?:would you|do you|did you|are you|can i|should i|shall i|is that|which|please confirm|let me know|tell me|your (?:permission|approval))\b/i;
  return !asksForReply.test(assistantText);
}
