import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { applyHost } from './host.js';
import { resolveDirectoryRoot } from './core.js';

export { inject } from './host.js';
export const name = 'quick-session';
export const Config = z.object({
  directoryRoot: z.string().default('').description('Absolute persistent directory root. Empty uses ~/Documents/DSH/QuickSessions. Changes affect new sessions only.'),
});

export function apply(ctx, config) {
  // Validate before any registration or filesystem side effect.
  resolveDirectoryRoot(config.directoryRoot);
  applyHost(ctx, config, defineTool);
}
