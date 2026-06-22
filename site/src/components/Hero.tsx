import { HeroDemo } from "./HeroDemo";
import { VERSION } from "../lib/site";
import { REPO, downloadUrl, useDetectedDownload, useDownloadHotkey } from "../lib/download";

export function Hero() {
  const detected = useDetectedDownload();
  const primaryHref = downloadUrl(detected.os);
  useDownloadHotkey(primaryHref);

  return (
    // overflow-x-clip here is a second line of defence: even if the demo stage
    // bleeds past its column on small screens it can never cause page scroll.
    <section className="mx-auto w-full max-w-6xl overflow-x-clip px-5 pt-14 pb-16 sm:px-8 sm:pt-16">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-12">
        {/* min-w-0 lets this column shrink instead of being forced wide. */}
        <div className="min-w-0">
          <a
            href={`${REPO}/releases/latest`}
            className="text-sm text-neutral-500 transition hover:text-neutral-900"
          >
            See what's new in {VERSION} <span aria-hidden="true">→</span>
          </a>
          <h1 className="wordmark mt-6 text-6xl sm:text-7xl">OPENDEX</h1>
          <p className="mt-6 text-xl font-bold sm:text-2xl">A voice-first AI for your desktop.</p>
          <p className="mt-4 max-w-2xl text-neutral-500">
            Speak, and Dex acts; local, free, open source and fully customizable.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={primaryHref}
              className="inline-flex items-center gap-2.5 rounded-md bg-neutral-900 px-5 py-3 font-bold text-white transition hover:bg-neutral-700"
            >
              <span>{detected.label}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
              </svg>
            </a>
            <a
              href={REPO}
              className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-neutral-600 transition hover:text-neutral-900"
            >
              View on GitHub <span aria-hidden="true">→</span>
            </a>
            {detected.note && <span className="text-xs text-neutral-400">{detected.note}</span>}
          </div>
        </div>

        {/* Animated live-demo. min-w-0 is essential: the demo authors on a fixed
            pixel surface, and without it that surface sets a min-content width
            that blows the grid (and the page) wider than the viewport. */}
        <div className="relative w-full min-w-0">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
