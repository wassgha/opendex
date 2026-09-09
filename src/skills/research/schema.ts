import { z } from "zod";

const webUrl = z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value), "Use an http or https source URL.");
export const researchSchema = z.object({
  topic: z.string().trim().min(1).max(160),
  stage: z.enum(["planning", "searching", "reading", "comparing", "synthesizing", "complete", "blocked"]),
  plan: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    status: z.enum(["pending", "active", "done"]),
  })).min(2).max(5),
  update: z.string().trim().min(1).max(600).describe("Current action or a concrete finding; never a fabricated activity."),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    url: webUrl,
    status: z.enum(["found", "read", "unavailable"]),
    note: z.string().trim().min(1).max(400).describe("Why this source matters; after reading, what it actually supports or contradicts."),
  })).max(24),
  findings: z.array(z.object({
    text: z.string().trim().min(1).max(600),
    sourceUrls: z.array(webUrl).min(1).max(5),
  })).max(12),
  openQuestions: z.array(z.string().trim().min(1).max(300)).max(4),
  milestone: z.enum(["none", "plan", "finding", "change_of_direction", "blocked"]).describe("Use a spoken milestone only for a meaningful development, not every click or source."),
}).superRefine((value, ctx) => {
  const read = new Set(value.sources.filter(source => source.status === "read").map(source => source.url));
  value.findings.forEach((finding, index) => {
    if (finding.sourceUrls.some(url => !read.has(url))) ctx.addIssue({ code: "custom", path: ["findings", index, "sourceUrls"], message: "Findings must cite sources listed as read in this update." });
  });
  if (value.stage === "complete" && (!value.findings.length || value.plan.some(step => step.status !== "done"))) {
    ctx.addIssue({ code: "custom", path: ["stage"], message: "Complete requires sourced findings and a finished plan; use blocked for incomplete research." });
  }
});
export type ResearchUpdate = z.infer<typeof researchSchema>;
