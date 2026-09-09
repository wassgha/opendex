// Static visual QA fixture, not a live research session. Writes only to /tmp.
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { ResearchCard } from "../src/skills/research/view";
import type { ResearchUpdate } from "../src/skills/research/schema";
const data: ResearchUpdate = {
  topic: "Where do the energy estimates disagree?", stage: "comparing", milestone: "finding",
  update: "The reports cover different years. I’m checking their definitions before comparing the totals.",
  plan: [{ title: "Find primary datasets and their methodology", status: "done" }, { title: "Compare dates, definitions, and assumptions", status: "active" }, { title: "Explain the agreement and remaining uncertainty", status: "pending" }],
  sources: [
    { title: "National energy statistics", url: "https://example.org/statistics", status: "read", note: "Sample source: includes a defined reporting period and methodology." },
    { title: "Independent analysis of demand", url: "https://example.org/analysis", status: "found", note: "Sample source: still needs reading before its claims can be used." },
    { title: "Historical data archive", url: "https://example.org/archive", status: "unavailable", note: "Sample source: access failed; no findings attributed to it." },
  ],
  findings: [{ text: "The reporting period must match before the totals can be compared.", sourceUrls: ["https://example.org/statistics"] }],
  openQuestions: ["Do both estimates include the same categories of energy use?"],
};
const dir = "/tmp/opendex-research-preview";
mkdirSync(dir, { recursive: true });
const css = readdirSync("out/renderer/assets").find(file => file.endsWith(".css"))!;
copyFileSync(`out/renderer/assets/${css}`, `${dir}/style.css`);
writeFileSync(`${dir}/index.html`, `<!doctype html><html class="dark"><meta charset="utf-8"><title>Dex research layout preview</title><link rel="stylesheet" href="style.css"><body style="padding:32px;background:var(--background);color:var(--foreground);font-family:system-ui"><p style="margin-bottom:24px">Layout preview · sample data, not research findings</p><div style="display:flex;gap:32px;flex-wrap:wrap"><div style="width:420px"><p style="margin-bottom:8px">Main view</p>${renderToStaticMarkup(<ResearchCard name="updateResearch" input={data} result={data} status="done" surface="main" />)}</div><div style="width:360px"><p style="margin-bottom:8px">Notch view</p>${renderToStaticMarkup(<ResearchCard name="updateResearch" input={data} result={data} status="done" surface="notch" />)}</div></div></body></html>`);
console.log(`${dir}/index.html`);
