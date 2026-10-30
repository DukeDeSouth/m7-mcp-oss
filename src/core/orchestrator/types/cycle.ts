/**
 * M7 Cycle Types
 * 
 * Defines the structure for M7 cycle orchestration.
 * v2: Reflection Gates — structured checkpoints between phases.
 */

export type PhaseType = 
  | 'intake'
  | 'discovery'
  | 'architecture'
  | 'solution'
  | 'impact'
  | 'simulation'
  | 'implementation';

export type ReflectionDecision = 'continue' | 'pivot' | 'rewind' | 'abort';

export type CycleSubmitKind = 'artifact' | 'reflection';

export type CycleStatus = 'active' | 'completed' | 'aborted';

export interface LastAcceptedSubmit {
  phase: PhaseType;
  kind: CycleSubmitKind;
  sha256: string;
}

export type GateWeight = 'heavy' | 'standard' | 'light';

export interface ReflectionGate {
  phase: PhaseType;
  decision: ReflectionDecision;
  changeDetected: boolean;
  summary: string;
  taskFramingUpdate?: string;   // only for pivot
  rewindTarget?: PhaseType;     // only for rewind
  confidence: number;
  timestamp: string;
}

export interface PhaseConfig {
  name: PhaseType;
  order: number;
  goal: string;
  nonGoals: string[];
  attentionLock: string;
  artifactTemplate: string;
  definitionOfDone: string[];
}

/** CYC-5: zeroed per-phase counter map for cycle state init/migrate. */
export function zeroPhaseCounters(): Record<PhaseType, number> {
  return {
    intake: 0,
    discovery: 0,
    architecture: 0,
    solution: 0,
    impact: 0,
    simulation: 0,
    implementation: 0,
  };
}

export interface CycleState {
  taskId: string;
  taskSlug: string;
  taskDescription: string;
  currentPhase: PhaseType;
  completedPhases: PhaseType[];
  artifacts: Record<PhaseType, string | null>;
  startedAt: string;  // ISO date
  lastUpdatedAt: string;
  /** @deprecated CYC-5 — no longer updated; kept for legacy JSON. */
  phaseAttempts: Record<PhaseType, number>;
  /** CYC-5: consecutive short artifact rejects per phase (reset on successful artifact). */
  shortArtifactAttempts: Record<PhaseType, number>;
  /** CYC-5: rewinds targeting this phase. */
  rewindCount: Record<PhaseType, number>;
  // v2: Reflection Gates
  awaitingReflection: boolean;
  taskFraming: string;
  reflections: ReflectionGate[];
  /** Sprint 2: idempotent recon task spawn at discovery gate */
  spawnedReconTaskIds?: string[];
  /** Sprint 2: metrics hook for Sprint 5 frontier shrink rate */
  frontierSnapshotAtDiscovery?: {
    explored: number;
    frontier: number;
    unknown: number;
    capturedAt: string;
  };
  /** Sprint 3: grounding stats at solution submit (metrics hook) */
  groundingCheckAtSolution?: {
    capturedAt: string;
    stats: {
      premises: number;
      steps: number;
      strongWarnings: number;
      softWarnings: number;
    };
    hasStrongWarning: boolean;
  };
  /** Sprint 5: epistemic quality metrics at cycle completion */
  epistemicMetricsAtCompletion?: {
    groundedRatio: number | null;
    frontierShrinkRate: number | null;
    hypothesisRefutationRate: number | null;
    capturedAt: string;
  };
  /** Sprint 7: nonce for control-channel integrity on reflection gates */
  gateInstructionId?: string;
  gateInstructionIssuedAt?: string;
  /** Sprint 8: MCP call counter since current phase entry */
  phaseMcpCallCount?: number;
  phaseEnteredAt?: string;
  lastRuleReinjectionAt?: string;
  /** CYC-2: idempotent replay of last successful submit (same phase, kind, content hash) */
  lastAccepted?: LastAcceptedSubmit;
  lastSuccessfulResponse?: CycleResponse;
  /** CYC-2 / CYC-3: cycle lifecycle (transitions in CYC-3) */
  status?: CycleStatus;
  /** CYC-4: project root captured at startCycle; all cycle I/O uses this path. */
  projectPath: string;
}

export interface CycleInstruction {
  taskId: string;
  phase: {
    name: PhaseType;
    order: number;
    goal: string;
    nonGoals: string[];
    attentionLock: string;
  };
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  artifact: {
    filename: string;
    path: string;
    template: string;
  };
  instruction: string;
  nextCall: string;
  // v2: gate info (present when awaiting reflection)
  gate?: {
    weight: GateWeight;
    prompt: string;
  };
}

export interface CycleRequest {
  task_description?: string;
  task_id?: string;
  artifact_content?: string;
}

export interface CycleResponse {
  success: boolean;
  instruction?: CycleInstruction;
  error?: string;
  completed?: boolean;
  /** CYC-3: persisted terminal status when completed === true */
  cycleStatus?: CycleStatus;
}
