import {
  getEpistemicView,
  type MemoryRecord,
} from './auto/unified-memory-core.js';
import {
  type MemoryConflictEntry,
  getRelationType,
} from './memoryRelations.js';

export type { MemoryConflictEntry } from './memoryRelations.js';

export function buildConflictReport(
  conflicts: MemoryConflictEntry[],
  lookup: (id: string) => MemoryRecord | null | undefined
): string {
  if (conflicts.length === 0) {
    return '';
  }

  const lines = conflicts.slice(0, 15).map((conflict, index) => {
    const recordA = lookup(conflict.recordA);
    const recordB = lookup(conflict.recordB);
    const statusA = recordA ? getEpistemicView(recordA).status : 'NOT_FOUND';
    const statusB = recordB ? getEpistemicView(recordB).status : 'NOT_FOUND';
    const confA = recordA?.confidence ?? conflict.confidenceA;
    const confB = recordB?.confidence ?? conflict.confidenceB;
    const rel = recordA ? getRelationType(recordA, conflict.recordB) : 'contradicts';

    return (
      `${index + 1}. \`${conflict.recordA}\` ↔ \`${conflict.recordB}\` ` +
      `| relation: ${rel ?? 'contradicts'} | epistemic: ${statusA} vs ${statusB} ` +
      `| conf: ${confA.toFixed(2)} / ${confB.toFixed(2)}`
    );
  });

  let report = `### Memory Conflicts (explicit contradicts)\n${lines.join('\n')}`;
  if (conflicts.length > 15) {
    report += `\n... and ${conflicts.length - 15} more conflicts`;
  }
  report += '\n\n💡 Resolve via verification or remove contradicts edge after reconciliation.';
  return report;
}
