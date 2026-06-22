import { REPO } from "../lib/download";

const COLUMNS = [
  {
    heading: "[Project]",
    links: [
      { href: REPO, label: "GitHub" },
      { href: `${REPO}/releases`, label: "Releases" },
      { href: `${REPO}#roadmap`, label: "Roadmap" },
    ],
  },
  {
    heading: "[Resources]",
    links: [
      { href: `${REPO}#readme`, label: "Docs" },
      { href: `${REPO}/releases`, label: "Changelog" },
      { href: `${REPO}/blob/main/PRIVACY.md`, label: "Privacy" },
    ],
  },
  {
    heading: "[Connect]",
    links: [
      { href: `${REPO}/issues`, label: "Issues" },
      { href: `${REPO}/discussions`, label: "Discussions" },
    ],
  },
  {
    heading: "[Get it]",
    links: [{ href: "#download", label: "Download" }],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-100 bg-neutral-50">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-5 py-16 sm:grid-cols-4 sm:px-8">
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <div className="text-sm text-neutral-400">{col.heading}</div>
            <ul className="mt-4 space-y-3 text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="transition hover:text-neutral-500">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl px-5 pb-12 text-sm text-neutral-400 sm:px-8">
        © 2026 OpenDex · open source
      </div>
    </footer>
  );
}
