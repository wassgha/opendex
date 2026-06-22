import { REPO } from "../lib/download";
import { VERSION } from "../lib/site";

export function AnnouncementBar() {
  return (
    <a
      href={`${REPO}/releases/latest`}
      className="block bg-neutral-900 px-4 py-2.5 text-center text-xs text-white/90 transition hover:text-white sm:text-sm"
    >
      OpenDex <span className="text-white/50">v{VERSION}</span> — a voice-first,
      open-source AI assistant <span aria-hidden="true">→</span>
    </a>
  );
}
