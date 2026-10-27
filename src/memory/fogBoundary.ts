import type { FogOfWarEntry } from './memorySystem.js';

export type BoundaryStatus = 'explored' | 'frontier' | 'unknown';

export const BOUNDARY_EXPLORED_CONF = 0.8;
export const BOUNDARY_UNKNOWN_CONF = 0.15;

export const BOUNDARY_EXPLORED_SOURCES: ReadonlySet<FogOfWarEntry['source']> = new Set([
  'code_analysis',
  'documentation',
  'human',
]);

export interface BoundaryCountSummary {
  explored: number;
  frontier: number;
  unknown: number;
}

export function computeBoundaryStatus(entry: FogOfWarEntry): BoundaryStatus {
  const discovery = (entry.discovery ?? '').trim();
  const conf = entry.confidence ?? 0;

  if (!discovery || conf < BOUNDARY_UNKNOWN_CONF) {
    return 'unknown';
  }

  if (conf >= BOUNDARY_EXPLORED_CONF && BOUNDARY_EXPLORED_SOURCES.has(entry.source)) {
    return 'explored';
  }

  return 'frontier';
}

export function deriveBlocking(
  entry: FogOfWarEntry,
  boundaryStatus: BoundaryStatus
): boolean {
  if (entry.blocking === false) {
    return false;
  }
  if (entry.blocking === true) {
    return true;
  }
  if (boundaryStatus === 'unknown' && entry.technical_details?.critical_path === true) {
    return true;
  }
  return false;
}

export function normalizeFogEntry(entry: FogOfWarEntry): FogOfWarEntry {
  const boundary_status = computeBoundaryStatus(entry);
  const blocking = deriveBlocking(entry, boundary_status);
  return { ...entry, boundary_status, blocking };
}

export function isBlockingUnknown(entry: FogOfWarEntry): boolean {
  const normalized = normalizeFogEntry(entry);
  return normalized.boundary_status === 'unknown' && normalized.blocking === true;
}

export function getBlockingUnknowns(entries: FogOfWarEntry[]): FogOfWarEntry[] {
  return entries
    .filter(e => !e.invalidated_at)
    .filter(isBlockingUnknown);
}

export function summarizeBoundaryCounts(entries: FogOfWarEntry[]): BoundaryCountSummary {
  const counts: BoundaryCountSummary = { explored: 0, frontier: 0, unknown: 0 };
  for (const entry of entries) {
    if (entry.invalidated_at) continue;
    const status = normalizeFogEntry(entry).boundary_status ?? 'unknown';
    counts[status]++;
  }
  return counts;
}

export function buildFrontierReport(entries: FogOfWarEntry[]): string {
  const active = entries.filter(e => !e.invalidated_at);
  const counts = summarizeBoundaryCounts(active);
  const blocking = getBlockingUnknowns(active);

  let blockingSection: string;
  if (blocking.length === 0) {
    blockingSection = '_No blocking unknowns._';
  } else {
    blockingSection = blocking
      .map(e => {
        const conf = (e.confidence ?? 0).toFixed(2);
        const note = (e.discovery ?? '').trim() ? 'unverified discovery' : 'no verified discovery';
        return `- \`${e.path}\` — confidence ${conf}, ${note}`;
      })
      .join('\n');
  }

  return `## Fog Frontier Report

| explored | frontier | unknown |
|----------|----------|---------|
| ${counts.explored} | ${counts.frontier} | ${counts.unknown} |

### Blocking unknowns
${blockingSection}`;
}
