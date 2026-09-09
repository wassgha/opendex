import { z } from 'zod';
import { meta, TOOLS } from './meta';
import type { Skill, SkillExecutionContext } from '../types';

export function benchmarkBlocker(context?: SkillExecutionContext) {
  if (!context) return 'Benchmark execution context is unavailable.';
  const missing = ['computer', 'open'].filter(id => !context.availableSkillIds.includes(id));
  return missing.length ? `Benchmark requires enabled, permitted skills: ${missing.join(', ')}. Do not change permissions automatically.` : undefined;
}
export const benchmarkSkill: Skill = {
  ...meta,
  isReady: () => Boolean(process.versions.electron),
  systemPrompt: `When the user asks you to benchmark yourself, run a browser benchmark, or measure your browser performance, call benchmarkDex action start. It starts a local fixture and returns the browser task; it has NOT completed the benchmark. Execute the returned task through existing screenshot/computer tools. In realtime, pass the full returned next instructions to the existing run_task desktop workflow, wait for its result, then call benchmarkDex action status to read authoritative scores. Never tell the user to launch a terminal or do the benchmark clicks. Do not start additional Codex tasks or recordings. Preserve all normal browser-control permission gates; stop on denial. Use action stop to finalize an abandoned/blocked benchmark. Use status for progress or the current run's result, not start. Never inspect fixture source, access fixture network endpoints, or use scripts to solve it. Only measured results justify completion. The first fully attempted suite becomes the persistent baseline; later runs compare against it. Starting again after a finished run creates a fresh comparison. Do not run repeatedly without a user request.`,
  tools: [{ name: TOOLS.benchmarkDex,
    description: 'Start Dex’s built-in browser benchmark on explicit request, read current measured results, or stop/finalize it. Start returns a task you must perform using normal computer tools (run_task in realtime). No CLI setup required. Status includes timing, misclicks, success/failure, score and baseline comparison.',
    inputSchema: z.object({ action: z.enum(['start', 'status', 'stop']) }),
    execute: async ({ action }: { action: 'start' | 'status' | 'stop' }, context) => {
      if (action === 'start') {
        const error = benchmarkBlocker(context);
        if (error) return { error };
        if (process.platform === 'darwin') {
          const { systemPreferences } = await import('electron');
          if (!systemPreferences.isTrustedAccessibilityClient(false)) return { error: 'Dex needs macOS Accessibility permission to perform benchmark browser actions.' };
          if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { error: 'Dex needs macOS Screen Recording permission to inspect the benchmark. No recording is started.' };
        }
      }
      const { benchmarkHost } = await import('../../main/benchmarks/host');
      const host = await benchmarkHost();
      if (action === 'status') return host.status();
      if (action === 'stop') return host.stop();
      const { app, screen } = await import('electron');
      const cfg = context!.config;
      const result = await host.start(JSON.stringify({ app: app.getVersion(), platform: process.platform,
        model: cfg.llm, mode: cfg.voice.mode, realtime: cfg.realtime.model,
        displays: screen.getAllDisplays().map(d => ({ width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor })),
        grants: { computer: cfg.skills.permissions.computer ?? 'ask', open: cfg.skills.permissions.open ?? 'ask' },
        browser: 'default browser; version/zoom and cold/warm state not automatically observed',
      }));
      if (context?.signal?.aborted) { await host.stop(); context.signal.throwIfAborted(); }
      return result;
    },
  }],
};
