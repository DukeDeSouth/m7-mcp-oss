import type { FogOfWarEntry } from '../../memory/memorySystem.js';
import path from 'path';
import { getProjectPath } from '../utils/projectPath.js';
import { CONTROL_CHANNEL_GROUNDING_BULLET } from './controlChannel.js';
import {
  getEpistemicStatus,
  type EpistemicStatus,
  type MemoryRecord,
  type SourceType,
} from '../../memory/auto/unified-memory-core.js';

export type Reversibility = 'reversible' | 'irreversible';
export type GroundingMode = 'full' | 'light';
export type WarningSeverity = 'soft' | 'strong';

export interface GroundingPremise {
  id: string;
  ref: string;
  claim: string;
}

export interface GroundingStep {
  id: string;
  description: string;
  reversibility: Reversibility;
  rollback?: string;
  premise_ids: string[];
}

export interface GroundingSpec {
  premises: GroundingPremise[];
  steps: GroundingStep[];
}

export interface GroundingWarning {
  premiseId: string;
  ref: string;
  status: EpistemicStatus | 'NOT_FOUND';
  severity: WarningSeverity;
  stepIds: string[];
  message: string;
}

export interface GroundingCheckResult {
  spec: GroundingSpec | null;
  warnings: GroundingWarning[];
  resolved: Array<{
    premiseId: string;
    ref: string;
    status: EpistemicStatus | 'NOT_FOUND';
    found: boolean;
  }>;
  stats: {
    premises: number;
    steps: number;
    strongWarnings: number;
    softWarnings: number;
  };
}

const PASS_STATUSES: ReadonlySet<EpistemicStatus> = new Set(['KNOWN', 'HUMAN_CONFIRMED']);

const FILESYSTEM_PREMISE_CONFIDENCE = 0.8;

function resolveSafeProjectPath(projectRoot: string, relativePath: string): string | null {
  const trimmed = relativePath.replace(/^\/+/, '').trim();
  if (!trimmed) {
    return null;
  }
  const absolute = path.resolve(projectRoot, trimmed);
  const rel = path.relative(projectRoot, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return absolute;
}

function buildFilesystemPremiseRecord(relPath: string): MemoryRecord {
  return {
    id: `path_${relPath.replace(/\W/g, '_')}`,
    content: `File exists: ${relPath}`,
    level: 'L1',
    source: 'documentation',
    contextKeys: [relPath],
    confidence: FILESYSTEM_PREMISE_CONFIDENCE,
    accessCount: 0,
    createdAt: new Date(),
    lastValidated: Date.now(),
    metadata: {
      type: 'reference_file',
      source: relPath,
      provenance: 'filesystem',
      tags: [relPath],
      importance: FILESYSTEM_PREMISE_CONFIDENCE,
    },
  };
}

function mergeFogOntoFilesystemRecord(
  base: MemoryRecord,
  fog: FogOfWarEntry
): MemoryRecord {
  const fogRec = fogEntryToMemoryRecord(fog);
  return {
    ...fogRec,
    metadata: {
      ...fogRec.metadata,
      provenance: 'filesystem',
    },
    confidence: Math.max(base.confidence, fogRec.confidence),
  };
}

export function warningSeverity(
  status: EpistemicStatus | 'NOT_FOUND',
  reversibility: Reversibility
): 'none' | WarningSeverity {
  if (status === 'NOT_FOUND') {
    return reversibility === 'irreversible' ? 'strong' : 'soft';
  }
  if (PASS_STATUSES.has(status)) {
    return 'none';
  }
  return reversibility === 'irreversible' ? 'strong' : 'soft';
}

export function fogEntryToMemoryRecord(entry: FogOfWarEntry): MemoryRecord {
  const createdAt =
    entry.discovered_at instanceof Date
      ? entry.discovered_at
      : new Date(entry.discovered_at);

  return {
    id: entry.id,
    content: entry.discovery,
    level: 'L1',
    source: (entry.source || 'code_analysis') as SourceType,
    contextKeys: [entry.path],
    confidence: entry.confidence,
    accessCount: 0,
    createdAt,
    metadata: {
      type: entry.source || 'code_analysis',
      source: entry.path,
      tags: [entry.path],
      importance: entry.confidence,
    },
  };
}

function normalizeReversibility(value: unknown): Reversibility {
  return value === 'irreversible' ? 'irreversible' : 'reversible';
}

function normalizeSpec(raw: Record<string, unknown>): GroundingSpec {
  const premisesRaw = Array.isArray(raw.premises) ? raw.premises : [];
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];

  const premises: GroundingPremise[] = premisesRaw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, index) => ({
      id: String(p.id ?? `p${index + 1}`),
      ref: String(p.ref ?? ''),
      claim: String(p.claim ?? ''),
    }))
    .filter(p => p.ref.length > 0);

  const steps: GroundingStep[] = stepsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, index) => ({
      id: String(s.id ?? `s${index + 1}`),
      description: String(s.description ?? ''),
      reversibility: normalizeReversibility(s.reversibility),
      rollback: s.rollback != null ? String(s.rollback) : undefined,
      premise_ids: Array.isArray(s.premise_ids)
        ? s.premise_ids.map(id => String(id))
        : [],
    }));

  return { premises, steps };
}

export function parseGroundingSpec(artifactContent: string): GroundingSpec | null {
  const blockRegex = /```json\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(artifactContent)) !== null) {
    try {
      const obj = JSON.parse(match[1]) as Record<string, unknown>;
      const grounding = obj.grounding as Record<string, unknown> | undefined;
      if (grounding && Array.isArray(grounding.premises)) {
        return normalizeSpec(grounding);
      }
    } catch {
      // skip invalid JSON blocks
    }
  }

  return null;
}

export async function resolvePremiseRef(ref: string): Promise<MemoryRecord | null> {
  const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
  const memCore = await getMemoryCore();

  let lookupRef = ref;
  if (ref.startsWith('path:')) {
    lookupRef = ref.slice(5).trim();
    const projectRoot = getProjectPath();
    const absolute = resolveSafeProjectPath(projectRoot, lookupRef);
    if (!absolute) {
      return null;
    }
    const { access } = await import('fs/promises');
    try {
      await access(absolute);
    } catch {
      return null;
    }

    let record = buildFilesystemPremiseRecord(lookupRef);
    const entries = await memCore.getFogOfWar({ path: lookupRef, includeInvalidated: false });
    const fog = entries.find(e => e.path === lookupRef) ?? entries[0];
    if (fog) {
      record = mergeFogOntoFilesystemRecord(record, fog);
    }
    return record;
  }

  if (ref.startsWith('fow_')) {
    const entries = await memCore.getFogOfWar({ includeInvalidated: false });
    const entry = entries.find(e => e.id === ref);
    return entry ? fogEntryToMemoryRecord(entry) : null;
  }

  const direct = await memCore.get(ref);
  if (direct) {
    return direct;
  }

  if (ref.includes('/') || ref.includes('.')) {
    const entries = await memCore.getFogOfWar({ path: ref, includeInvalidated: false });
    const exact = entries.find(e => e.path === ref);
    const entry = exact ?? entries[0];
    return entry ? fogEntryToMemoryRecord(entry) : null;
  }

  return null;
}

export async function runGroundingCheck(
  spec: GroundingSpec | null,
  mode: GroundingMode
): Promise<GroundingCheckResult> {
  if (!spec) {
    return {
      spec: null,
      warnings: [{
        premiseId: '-',
        ref: '-',
        status: 'NOT_FOUND',
        severity: 'soft',
        stepIds: [],
        message: 'No grounding JSON declared in solution artifact — list premises with memory/fog refs.',
      }],
      resolved: [],
      stats: { premises: 0, steps: 0, strongWarnings: 0, softWarnings: 1 },
    };
  }

  const steps =
    mode === 'light'
      ? spec.steps.filter(s => s.reversibility === 'irreversible')
      : spec.steps;

  const premiseById = new Map(spec.premises.map(p => [p.id, p]));
  const resolved: GroundingCheckResult['resolved'] = [];
  const statusByPremiseId = new Map<string, EpistemicStatus | 'NOT_FOUND'>();

  for (const premise of spec.premises) {
    const record = await resolvePremiseRef(premise.ref);
    const status: EpistemicStatus | 'NOT_FOUND' = record
      ? getEpistemicStatus(record)
      : 'NOT_FOUND';
    statusByPremiseId.set(premise.id, status);
    resolved.push({
      premiseId: premise.id,
      ref: premise.ref,
      status,
      found: record !== null,
    });
  }

  const warnings: GroundingWarning[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (
      step.reversibility === 'irreversible'
      && step.premise_ids.length === 0
    ) {
      const key = `irreversible-no-premises:${step.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push({
          premiseId: '-',
          ref: '-',
          status: 'NOT_FOUND',
          severity: 'strong',
          stepIds: [step.id],
          message: `Irreversible step "${step.id}" declares no premise_ids — grounding cannot be verified.`,
        });
      }
      continue;
    }

    for (const premiseId of step.premise_ids) {
      const premise = premiseById.get(premiseId);
      if (!premise) {
        const key = `missing-premise:${premiseId}:${step.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          warnings.push({
            premiseId,
            ref: '-',
            status: 'NOT_FOUND',
            severity: step.reversibility === 'irreversible' ? 'strong' : 'soft',
            stepIds: [step.id],
            message: `Step "${step.id}" references unknown premise_id "${premiseId}".`,
          });
        }
        continue;
      }

      const status = statusByPremiseId.get(premiseId) ?? 'NOT_FOUND';
      const severity = warningSeverity(status, step.reversibility);
      if (severity === 'none') {
        continue;
      }

      const key = `${premiseId}:${severity}:${status}`;
      if (seen.has(key)) {
        const existing = warnings.find(
          w => w.premiseId === premiseId && w.severity === severity && w.status === status
        );
        if (existing && !existing.stepIds.includes(step.id)) {
          existing.stepIds.push(step.id);
        }
        continue;
      }
      seen.add(key);

      const statusLabel = status === 'NOT_FOUND' ? 'NOT_FOUND' : status;
      warnings.push({
        premiseId,
        ref: premise.ref,
        status,
        severity,
        stepIds: [step.id],
        message:
          status === 'NOT_FOUND'
            ? `Premise "${premiseId}" ref \`${premise.ref}\` not found in memory/fog.`
            : `Premise "${premiseId}" is ${statusLabel} — used by step "${step.id}" (${step.reversibility}).`,
      });
    }
  }

  const strongWarnings = warnings.filter(w => w.severity === 'strong').length;
  const softWarnings = warnings.filter(w => w.severity === 'soft').length;

  return {
    spec,
    warnings,
    resolved,
    stats: {
      premises: spec.premises.length,
      steps: steps.length,
      strongWarnings,
      softWarnings,
    },
  };
}

export function buildGroundingReport(result: GroundingCheckResult): string {
  const { stats } = result;
  const modeLabel = result.spec ? 'Epistemic Grounding Report' : 'Epistemic Grounding Report (missing spec)';

  let resolvedSection: string;
  if (result.resolved.length === 0) {
    resolvedSection = '_No premises resolved._';
  } else {
    resolvedSection = result.resolved
      .map(r => {
        const icon = r.found && PASS_STATUSES.has(r.status as EpistemicStatus) ? '✅' : '⚠️';
        return `- ${icon} \`${r.premiseId}\` ref \`${r.ref}\` → **${r.status}**`;
      })
      .join('\n');
  }

  let warningsSection: string;
  if (result.warnings.length === 0) {
    warningsSection = '_No grounding warnings — premises sufficient for classified steps._';
  } else {
    warningsSection = result.warnings
      .slice(0, 15)
      .map(w => {
        const tag = w.severity === 'strong' ? '🔶 STRONG' : '⚠️ soft';
        const steps = w.stepIds.length ? ` (steps: ${w.stepIds.join(', ')})` : '';
        return `- ${tag}: ${w.message}${steps}`;
      })
      .join('\n');
    if (result.warnings.length > 15) {
      warningsSection += `\n- ... and ${result.warnings.length - 15} more warnings`;
    }
  }

  return `## ${modeLabel}

| premises | steps checked | strong | soft |
|----------|---------------|--------|------|
| ${stats.premises} | ${stats.steps} | ${stats.strongWarnings} | ${stats.softWarnings} |

### Premise verification
${resolvedSection}

### Grounding warnings
${warningsSection}

💡 Verify weak premises: \`mcp_m7_memory action="discover_technical"\` or \`action="search"\``;
}

export function generateGroundingGateExtension(
  report: string,
  mode: GroundingMode,
  hasStrongWarning: boolean
): string {
  const modeNote =
    mode === 'light'
      ? '_Light re-check before IMPLEMENTATION — irreversible steps only._'
      : '_Full grounding check before IMPACT._';

  const strongNote = hasStrongWarning
    ? '- **Strong warnings present** — address in reflection summary or justify continue with verification plan.'
    : '- No strong warnings on irreversible steps.';

  return `${report}

### Grounding exit decision (required in reflection summary)
${modeNote}
- List any ASSUMED/UNKNOWN/STALE premises you accept for irreversible steps and why.
${strongNote}
${CONTROL_CHANNEL_GROUNDING_BULLET}`;
}
