/**
 * MEM-3: Drain debounced persistence (memory, journal, …) before process.exit.
 */

export const SHUTDOWN_FLUSH_TIMEOUT_MS = 2000;

const contributors: Array<() => Promise<void>> = [];

export function registerShutdownContributor(fn: () => Promise<void>): void {
  contributors.push(fn);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function flushAll(): Promise<void> {
  const { shutdownMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
  const tasks = [shutdownMemoryCore(), ...contributors.map(c => c())];
  await Promise.allSettled(tasks);
}

export async function flushAllWithTimeout(): Promise<'done' | 'timeout'> {
  return Promise.race([
    flushAll().then(() => 'done' as const),
    sleep(SHUTDOWN_FLUSH_TIMEOUT_MS).then(() => 'timeout' as const),
  ]);
}
