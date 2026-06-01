// Display-only list of the dashboards Jarvis "opens" during the morning
// briefing. Renderer-side UI data — the actual metrics that ground the spoken
// briefing live in the main process (src/main/agent/briefing-data.ts).
//
// In Phase 2 this becomes part of the configurable "example profile".

export interface BriefingSource {
  id: string;
  label: string; // shown on the animated "tab" chip
  detail: string; // sub-label
}

export const BRIEFING_SOURCES: BriefingSource[] = [
  { id: "ga", label: "Google Analytics", detail: "traffic & engagement" },
  { id: "nubio", label: "Nubio", detail: "product analytics" },
  { id: "stripe", label: "Stripe", detail: "revenue & billing" },
];
