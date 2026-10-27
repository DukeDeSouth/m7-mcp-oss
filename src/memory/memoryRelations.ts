import type { MemoryRecord } from './auto/unified-memory-core.js';

export type MemoryRelationType =
  | 'supports'
  | 'contradicts'
  | 'refines'
  | 'derived_from';

export const MEMORY_RELATION_TYPES: readonly MemoryRelationType[] = [
  'supports',
  'contradicts',
  'refines',
  'derived_from',
] as const;

export const CONTRADICT_CONFIDENCE_FACTOR = 0.6;
export const MIN_CONFIDENCE = 0.1;

export interface DependencySpec {
  id: string;
  relationType: MemoryRelationType;
}

export function normalizeDependencySpecs(
  dependencies?: string[],
  specs?: DependencySpec[]
): { deps: string[]; relations: Record<string, MemoryRelationType> } {
  const relations: Record<string, MemoryRelationType> = {};
  const depSet = new Set<string>(dependencies ?? []);

  if (specs?.length) {
    for (const spec of specs) {
      depSet.add(spec.id);
      relations[spec.id] = spec.relationType;
    }
  }

  return { deps: [...depSet], relations };
}

export function getRelationType(
  record: MemoryRecord,
  depId: string
): MemoryRelationType | undefined {
  return record.dependencyRelations?.[depId];
}

/**
 * Apply confidence penalty to both sides of an explicit contradicts edge.
 * Does not cascade to other dependents.
 */
export function applyContradictPenalties(
  dependent: MemoryRecord,
  target: MemoryRecord
): void {
  dependent.confidence = Math.max(
    MIN_CONFIDENCE,
    (dependent.confidence ?? 0.8) * CONTRADICT_CONFIDENCE_FACTOR
  );
  target.confidence = Math.max(
    MIN_CONFIDENCE,
    (target.confidence ?? 0.8) * CONTRADICT_CONFIDENCE_FACTOR
  );
  dependent.lastValidated = 0;
  target.lastValidated = 0;
}

export function getContradictDependencyIds(
  record: MemoryRecord
): string[] {
  if (!record.dependencyRelations) {
    return [];
  }
  return Object.entries(record.dependencyRelations)
    .filter(([, type]) => type === 'contradicts')
    .map(([id]) => id);
}

export interface MemoryConflictEntry {
  id: string;
  recordA: string;
  recordB: string;
  detectedAt: string;
  confidenceA: number;
  confidenceB: number;
}

export function collectActiveConflicts(
  records: Iterable<MemoryRecord>
): MemoryConflictEntry[] {
  const seen = new Set<string>();
  const conflicts: MemoryConflictEntry[] = [];

  for (const record of records) {
    if (!record.dependencyRelations) {
      continue;
    }

    for (const [depId, relType] of Object.entries(record.dependencyRelations)) {
      if (relType !== 'contradicts') {
        continue;
      }

      const key = [record.id, depId].sort().join('::');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      conflicts.push({
        id: `conflict_${key.replace(/::/g, '_')}`,
        recordA: record.id,
        recordB: depId,
        detectedAt: new Date().toISOString(),
        confidenceA: record.confidence ?? 0,
        confidenceB: 0,
      });
    }
  }

  return conflicts;
}
