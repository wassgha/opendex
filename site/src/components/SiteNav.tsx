import { REPO } from "../lib/download";

const NAV_LINKS = [
  { href: "#features", label: "Features", external: false },
  { href: "#themes", label: "Themes", external: false },
  { href: `${REPO}#readme`, label: "Docs", external: true },
  { href: `${REPO}/releases`, label: "Changelog", external: true },
];

export function SiteNav() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <a href="#top" className="flex items-center gap-2.5">
        <img src="./icon.png" alt="" className="h-7 w-7 rounded-md" />
        <span className="wordmark text-lg">OpenDex</span>
      </a>
      <nav className="flex items-center gap-5 text-sm text-neutral-500">
        {NAV_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="hidden transition hover:text-neutral-900 sm:inline"
          >
            {link.label}
          </a>
        ))}
        <a href={REPO} className="transition hover:text-neutral-900">
          GitHub
        </a>
        <a
          href="#download"
          className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3.5 py-2 text-white transition hover:bg-neutral-700"
        >
          Download
          <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/80">
            D
          </kbd>
        </a>
      </nav>
    </header>
  );
}
