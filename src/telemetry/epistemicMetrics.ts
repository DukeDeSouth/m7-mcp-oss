import type { CycleState } from '../core/orchestrator/types/cycle.js';
import type { BoundaryCountSummary } from '../memory/fogBoundary.js';
import type { EpistemicStatus } from '../memory/auto/unified-memory-core.js';
import {
  parseGroundingSpec,
  runGroundingCheck,
  type GroundingCheckResult,
  type GroundingSpec,
} from '../core/orchestrator/groundingGate.js';
import type { M7SessionEvent } from './types.js';

const PASS_STATUSES: ReadonlySet<EpistemicStatus> = new Set(['KNOWN', 'HUMAN_CONFIRMED']);

export interface EpistemicMetricsSnapshot {
  taskId: string;
  taskSlug: string;
  capturedAt: string;
  groundedRatio: number | null;
  groundedSteps: number;
  totalGroundingSteps: number;
  frontierShrinkRate: number | null;
  frontierInitial: number | null;
  frontierFinal: number | null;
  frontierDelta: number | null;
  unknownDelta: number | null;
  exploredDelta: number | null;
  hypothesisRefutationRate: number | null;
  refutationEvents: number;
  totalReflections: number;
  notes?: string[];
}

export function computeGroundedRatio(
  spec: GroundingSpec | null,
  resolved: GroundingCheckResult['resolved']
): Pick<EpistemicMetricsSnapshot, 'groundedRatio' | 'groundedSteps' | 'totalGroundingSteps'> {
  if (!spec || spec.steps.length === 0) {
    return { groundedRatio: null, groundedSteps: 0, totalGroundingSteps: 0 };
  }

  const statusMap = new Map(resolved.map(r => [r.premiseId, r.status]));
  let groundedSteps = 0;

  for (const step of spec.steps) {
    if (step.premise_ids.length === 0) {
      continue;
    }
    const allPass = step.premise_ids.every(id => {
      const status = statusMap.get(id);
      return status !== undefined &&
        status !== 'NOT_FOUND' &&
        PASS_STATUSES.has(status as EpistemicStatus);
    });
    if (allPass) {
      groundedSteps++;
    }
  }

  const totalGroundingSteps = spec.steps.length;
  return {
    groundedRatio: totalGroundingSteps > 0 ? groundedSteps / totalGroundingSteps : null,
    groundedSteps,
    totalGroundingSteps,
  };
}

export function computeFrontierShrinkMetrics(
  initial: BoundaryCountSummary | undefined,
  final: BoundaryCountSummary
): Pick<
  EpistemicMetricsSnapshot,
  | 'frontierShrinkRate'
  | 'frontierInitial'
  | 'frontierFinal'
  | 'frontierDelta'
  | 'unknownDelta'
  | 'exploredDelta'
> {
  if (!initial) {
    return {
      frontierShrinkRate: null,
      frontierInitial: null,
      frontierFinal: final.frontier,
      frontierDelta: null,
      unknownDelta: null,
      exploredDelta: null,
    };
  }

  const frontierDelta = initial.frontier - final.frontier;
  const frontierShrinkRate =
    initial.frontier > 0
      ? frontierDelta / initial.frontier
      : frontierDelta <= 0
        ? 0
        : null;

  return {
    frontierShrinkRate,
    frontierInitial: initial.frontier,
    frontierFinal: final.frontier,
    frontierDelta,
    unknownDelta: initial.unknown - final.unknown,
    exploredDelta: final.explored - initial.explored,
  };
}

export function computeHypothesisRefutationRate(
  reflections: CycleState['reflections']
): Pick<
  EpistemicMetricsSnapshot,
  'hypothesisRefutationRate' | 'refutationEvents' | 'totalReflections'
> {
  const totalReflections = reflections.length;
  if (totalReflections === 0) {
    return {
      hypothesisRefutationRate: null,
      refutationEvents: 0,
      totalReflections: 0,
    };
  }

  const refutationEvents = reflections.filter(
    r => r.decision === 'pivot' || r.decision === 'rewind'
  ).length;

  return {
    hypothesisRefutationRate: refutationEvents / totalReflections,
    refutationEvents,
    totalReflections,
  };
}

export async function buildEpistemicMetricsSnapshot(
  state: CycleState,
  finalBoundaryCounts: BoundaryCountSummary
): Promise<EpistemicMetricsSnapshot> {
  const solutionArtifact = state.artifacts.solution ?? '';
  const spec = parseGroundingSpec(solutionArtifact);
  const groundingResult = await runGroundingCheck(spec, 'full');

  const grounded = computeGroundedRatio(spec, groundingResult.resolved);
  const frontier = computeFrontierShrinkMetrics(
    state.frontierSnapshotAtDiscovery
      ? {
          explored: state.frontierSnapshotAtDiscovery.explored,
          frontier: state.frontierSnapshotAtDiscovery.frontier,
          unknown: state.frontierSnapshotAtDiscovery.unknown,
        }
      : undefined,
    finalBoundaryCounts
  );
  const hypothesis = computeHypothesisRefutationRate(state.reflections);

  const notes: string[] = [];
  if (!state.frontierSnapshotAtDiscovery) {
    notes.push('no_frontier_snapshot');
  }
  if (!spec) {
    notes.push('no_grounding_spec');
  }
  if (state.reflections.length === 0) {
    notes.push('no_reflections');
  }

  return {
    taskId: state.taskId,
    taskSlug: state.taskSlug,
    capturedAt: new Date().toISOString(),
    ...grounded,
    ...frontier,
    ...hypothesis,
    notes: notes.length > 0 ? notes : undefined,
  };
}

export async function appendEpistemicMetricsRecord(
  projectPath: string,
  record: EpistemicMetricsSnapshot
): Promise<void> {
  const { mkdir, appendFile } = await import('fs/promises');
  const { join } = await import('path');
  const dir = join(projectPath, '.m7');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'epistemic-metrics.jsonl');
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf-8');
}

export async function emitEpistemicMetricsForCycle(
  state: CycleState,
  projectPath: string
): Promise<EpistemicMetricsSnapshot> {
  const { getMemoryCore } = await import('../memory/auto/unified-memory-core.js');
  const { summarizeBoundaryCounts } = await import('../memory/fogBoundary.js');
  const memCore = await getMemoryCore();
  const fog = await memCore.getFogOfWar();
  const finalCounts = summarizeBoundaryCounts(fog);
  const snapshot = await buildEpistemicMetricsSnapshot(state, finalCounts);

  await appendEpistemicMetricsRecord(projectPath, snapshot);

  try {
    const { collectTelemetry } = await import('./collector.js');
    const started = new Date(state.startedAt).getTime();
    const durationMs = Math.max(0, Date.now() - started);

    collectTelemetry({
      type: 'm7_session',
      timestamp: snapshot.capturedAt,
      session: {
        id: state.taskId,
        route: 'heavy',
        phases_completed: [...state.completedPhases],
        duration_ms: durationMs,
      },
      task: {
        description: state.taskDescription.substring(0, 500),
      },
      outcome: {
        success: true,
        epistemic: {
          grounded_ratio: snapshot.groundedRatio,
          frontier_shrink_rate: snapshot.frontierShrinkRate,
          hypothesis_refutation_rate: snapshot.hypothesisRefutationRate,
          grounded_steps: snapshot.groundedSteps,
          total_grounding_steps: snapshot.totalGroundingSteps,
          refutation_events: snapshot.refutationEvents,
          total_reflections: snapshot.totalReflections,
        },
      },
    } as M7SessionEvent);
  } catch (err) {
    // Telemetry is optional; local JSONL is the primary sink
    void err;
  }

  return snapshot;
}
