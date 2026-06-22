import { REPO, downloadUrl, type OSKey } from "../lib/download";

const BUILDS: { os: OSKey; img: string; alt: string }[] = [
  {
    os: "mac-arm64",
    img: "./download/download-macos-arm64.svg",
    alt: "Download for macOS — Apple Silicon",
  },
  { os: "mac-x64", img: "./download/download-macos-x64.svg", alt: "Download for macOS — Intel" },
  { os: "win", img: "./download/download-windows.svg", alt: "Download for Windows" },
  {
    os: "linux-appimage",
    img: "./download/download-linux-appimage.svg",
    alt: "Download the AppImage for Linux",
  },
  { os: "linux-deb", img: "./download/download-debian-deb.svg", alt: "Download the .deb for Debian" },
];

export function Download() {
  return (
    <section id="download" className="border-t border-neutral-100 bg-neutral-50/60">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <h2 className="wordmark text-3xl sm:text-4xl">Download OpenDex.</h2>
        <p className="mt-3 text-neutral-500">
          Free and open source. We picked the build for your system — everything else is below.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {BUILDS.map((build) => (
            <a
              key={build.os}
              href={downloadUrl(build.os)}
              className="inline-block rounded-md transition hover:opacity-80"
            >
              <img src={build.img} alt={build.alt} height={48} className="h-12" />
            </a>
          ))}
        </div>

        <p className="mt-6 text-sm text-neutral-400">
          Or browse every version on the{" "}
          <a href={`${REPO}/releases`} className="underline hover:text-neutral-900">
            Releases
          </a>{" "}
          page.
        </p>
      </div>
    </section>
  );
}
