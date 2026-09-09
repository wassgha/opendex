import type { SkillMeta } from '../types';
export const meta: SkillMeta = {
  id: 'benchmark', label: 'Browser benchmark', sensitive: false,
  description: 'Run golden browser tasks and measure time, accuracy, and changes against a saved baseline. Browser actions retain their own permission gates.',
};
export const TOOLS = { benchmarkDex: 'benchmarkDex' } as const;
