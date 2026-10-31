/**
 * M7 Cycle Orchestrator
 * 
 * Manages M7 cycle state and provides explicit instructions for AI.
 * This is the core component of the "MCP as Orchestrator" pattern.
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomBytes } from 'node:crypto';
import { getProjectPath } from '../utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../utils/atomicWrite.js';
import { StatePersistError } from '../errors/statePersist.js';
const CYCLES_DIR = 'm7-cycles';
import {
  CycleState,
  CycleInstruction,
  PhaseType,
  CycleResponse,
  ReflectionGate,
  ReflectionDecision,
  GateWeight,
  CycleSubmitKind,
  CycleStatus,
  zeroPhaseCounters,
} from './types/cycle.js';
import {
  PHASE_CONFIGS,
  getPhaseConfig,
  getNextPhase,
  isLastPhase,
  getGateWeight,
  generateGateTemplate,
  generateDiscoveryGateExtension
} from './templates/phases.js';
import { buildFrontierReport, summarizeBoundaryCounts } from '../../memory/fogBoundary.js';
import { spawnReconTasksForBlockingUnknowns } from './frontierReconSpawner.js';
import {
  parseGroundingSpec,
  runGroundingCheck,
  buildGroundingReport,
  generateGroundingGateExtension,
} from './groundingGate.js';
import { generateAdversarialGateExtension } from './adversarialGate.js';
import {
  CONTROL_CHANNEL_CARRY_FORWARD,
  formatGateIdBlock,
  generateGateInstructionId,
  validateGateInstructionId,
} from './controlChannel.js';
import {
  appendRuleReinjection,
  buildRuleReinjectionBlock,
  resetPhaseMcpTracking,
  trackPhaseMcpCall,
} from './ruleReinjection.js';

const log = createLogger('[cycleOrchestrator]');

/** Result of parsing a reflection submission. ok:false never advances the cycle. */
type ParsedReflection =
  | { ok: true; reflection: ReflectionGate }
  | { ok: false; reason: string };

export class CycleOrchestrator {
  private static readonly MAX_SHORT_ARTIFACT_ATTEMPTS = 3;
  private static readonly MAX_REWINDS_PER_TARGET = 2;
  private static readonly MIN_ARTIFACT_LENGTH = 100;

  private cycles: Map<string, CycleState> = new Map();
  private cyclesDir: string;
  /** CYC-4: taskId → project root for cold getState */
  private taskProjectRoots = new Map<string, string>();
  /** CYC-2: serialize submit/reflection/rewind per task */
  private taskQueues = new Map<string, Promise<unknown>>();
  /** CYC-10: ids handed out by allocateCycleIdentity whose state is not committed yet */
  private reservedTaskIds = new Set<string>();
  private static readonly MAX_ID_ATTEMPTS = 8;
  
  constructor() {
    const projectPath = getProjectPath();
    this.cyclesDir = path.join(projectPath, '.m7', 'cycles');
  }

  /** CYC-4 */
  private cyclesDirForProject(projectPath: string): string {
    return path.join(projectPath, '.m7', 'cycles');
  }

  private artifactsDirForState(state: CycleState): string {
    return path.join(state.projectPath, CYCLES_DIR, state.taskSlug);
  }

  private cycleStatePathFor(projectPath: string, taskId: string): string {
    return path.join(this.cyclesDirForProject(projectPath), `${taskId}.json`);
  }

  private projectRootFromStateFile(statePath: string): string {
    return path.resolve(path.dirname(statePath), '..', '..');
  }
  
  /**
   * CYC-10: a taskId and an artifact folder that no other cycle has. The folder is
   * `<slug>-<suffix>` with the taskId's own suffix and is created here, exclusively.
   */
  private async allocateCycleIdentity(
    description: string,
    projectPath: string
  ): Promise<{ taskId: string; taskSlug: string; artifactsDir: string }> {
    const slug = this.generateSlug(description);
    const cyclesRoot = path.join(projectPath, CYCLES_DIR);
    await fs.mkdir(cyclesRoot, { recursive: true });

    for (let attempt = 0; attempt < CycleOrchestrator.MAX_ID_ATTEMPTS; attempt++) {
      const suffix = this.nextIdSuffix();
      const taskId = this.generateTaskId(description, suffix);
      if (this.cycles.has(taskId) || this.reservedTaskIds.has(taskId)) continue;
      this.reservedTaskIds.add(taskId);

      const taskSlug = `${slug}-${suffix}`;
      const artifactsDir = path.join(cyclesRoot, taskSlug);
      try {
        if (await this.fileExists(this.cycleStatePathFor(projectPath, taskId))) {
          this.reservedTaskIds.delete(taskId);
          continue;
        }
        await fs.mkdir(artifactsDir);
        return { taskId, taskSlug, artifactsDir };
      } catch (err) {
        this.reservedTaskIds.delete(taskId);
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error(
      `Could not allocate a unique cycle id after ${CycleOrchestrator.MAX_ID_ATTEMPTS} attempts`
    );
  }

  private nextIdSuffix(): string {
    return randomBytes(3).toString('hex');
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove cycle state files older than 7 days (CYC-9: skip active; archive completed)
   */
  private async cleanupOldCycles(projectPath: string): Promise<void> {
    const cyclesDir = this.cyclesDirForProject(projectPath);
    try {
      await fs.mkdir(cyclesDir, { recursive: true });
      const archiveDir = path.join(cyclesDir, 'archive');
      await fs.mkdir(archiveDir, { recursive: true });
      const files = await fs.readdir(cyclesDir);
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        if (file === 'archive') continue;
        if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
        if (file.endsWith('.jsonl')) continue; // handled with matching .json

        const filePath = path.join(cyclesDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs <= maxAge) continue;

          const raw = await fs.readFile(filePath, 'utf-8');
          let state: CycleState;
          try {
            state = JSON.parse(raw) as CycleState;
          } catch {
            log.warn(`CYC-9: skipping cleanup of unreadable cycle state: ${file}`);
            continue;
          }

          if (this.isCycleStateActive(state)) {
            log.debug(`CYC-9: keeping old active cycle state: ${file}`);
            continue;
          }

          const dest = path.join(archiveDir, file);
          await fs.rename(filePath, dest);
          const cycleId = file.replace(/\.json$/, '');
          this.cycles.delete(cycleId);
          const logPath = path.join(cyclesDir, `${cycleId}_REFLECTION_LOG.jsonl`);
          try {
            await fs.access(logPath);
            await fs.rename(logPath, path.join(archiveDir, `${cycleId}_REFLECTION_LOG.jsonl`));
          } catch {
            /* no reflection log */
          }
          log.info(`CYC-9: archived old cycle state: ${file}`);
        } catch {
          // Skip files that can't be processed
        }
      }
    } catch {
      // Non-critical — silently ignore cleanup failures
    }
  }

  /** Active cycles must not be deleted by age-only cleanup (CYC-9). */
  private isCycleStateActive(state: CycleState): boolean {
    const status = (state as CycleState & { status?: string }).status;
    if (status === 'active') return true;
    if (status === 'completed' || status === 'aborted') return false;
    return state.completedPhases.length < 7;
  }

  /** CYC-3: reject artifact/reflection submits after terminal lifecycle. */
  private rejectIfTerminal(state: CycleState): CycleResponse | null {
    const s = state.status;
    if (s === 'completed' || s === 'aborted') {
      return { success: false, error: `Cycle is ${s}` };
    }
    if (s === 'active') {
      return null;
    }
    if (state.completedPhases.length >= 7) {
      return { success: false, error: 'Cycle is completed' };
    }
    return null;
  }

  /**
   * Start a new M7 cycle
   */
  async startCycle(description: string): Promise<CycleInstruction> {
    const ownerProject = getProjectPath();
    await this.cleanupOldCycles(ownerProject);
    const { taskId, taskSlug, artifactsDir } = await this.allocateCycleIdentity(description, ownerProject);

    const state: CycleState = {
      taskId,
      taskSlug,
      taskDescription: description,
      projectPath: ownerProject,
      currentPhase: 'intake',
      completedPhases: [],
      artifacts: {
        intake: null,
        discovery: null,
        architecture: null,
        solution: null,
        impact: null,
        simulation: null,
        implementation: null
      },
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      phaseAttempts: zeroPhaseCounters(),
      shortArtifactAttempts: zeroPhaseCounters(),
      rewindCount: zeroPhaseCounters(),
      // v2: Reflection Gates
      awaitingReflection: false,
      taskFraming: description,
      reflections: [],
      phaseMcpCallCount: 0,
      phaseEnteredAt: new Date().toISOString(),
      status: 'active',
    };
    
    // Persist before exposing cycle in memory
    try {
      await this.commitState(state);
    } catch (err) {
      await fs.rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    } finally {
      this.reservedTaskIds.delete(taskId);
    }

    log.debug(`Started M7 Cycle: ${taskId}`);
    
    const committed = this.cycles.get(taskId)!;
    const fin = await this.finalizeInstruction(committed, this.generateInstruction(committed));
    if ('success' in fin && fin.success === false) {
      throw new StatePersistError(
        this.cycleStatePathFor(ownerProject, taskId),
        fin.error ?? 'finalize instruction persist failed'
      );
    }
    return fin as CycleInstruction;
  }
  
  /**
   * Submit artifact and get next instruction
   */
  async submitArtifact(
    taskId: string,
    artifactContent: string
  ): Promise<CycleResponse> {
    return this.enqueue(taskId, () =>
      this.submitArtifactInner(taskId, artifactContent)
    );
  }

  private async submitArtifactInner(
    taskId: string,
    artifactContent: string
  ): Promise<CycleResponse> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }

    const terminalArtifact = this.rejectIfTerminal(state);
    if (terminalArtifact) {
      return terminalArtifact;
    }

    const replay = this.tryIdempotentReplay(state, 'artifact', artifactContent);
    if (replay) {
      return replay;
    }

    if (state.awaitingReflection) {
      return {
        success: false,
        error:
          'Cycle is awaiting reflection. Submit the reflection JSON for the current gate, not another artifact.',
      };
    }
    
    // Validate artifact (basic length check)
    const minLength = CycleOrchestrator.MIN_ARTIFACT_LENGTH;
    if (!artifactContent || artifactContent.trim().length < minLength) {
      const attemptResult = await this.withCommittedState(taskId, draft => {
        draft.shortArtifactAttempts[draft.currentPhase]++;
      });
      if (this.isPersistFailure(attemptResult)) {
        return attemptResult;
      }
      const after = attemptResult.committed;
      const n = after.shortArtifactAttempts[after.currentPhase];

      if (n >= CycleOrchestrator.MAX_SHORT_ARTIFACT_ATTEMPTS) {
        return {
          success: false,
          error:
            `Phase stuck: ${n} short artifacts at ${after.currentPhase}. ` +
            `Submit a valid artifact (≥${minLength} chars) or abort the cycle.`,
        };
      }
      return {
        success: false,
        error:
          `Artifact too short (${artifactContent.trim().length} chars). ` +
          `Minimum ${minLength} chars required. Attempt ${n}/3.`,
      };
    }

    const pre = state;

    const artifactsDir = this.artifactsDirForState(pre);
    const filename = this.getArtifactFilename(pre.currentPhase);

    try {
      await fs.mkdir(artifactsDir, { recursive: true });
      await this.writePhaseArtifactFile(
        path.join(artifactsDir, filename),
        pre,
        artifactContent
      );
      log.debug(`Saved artifact: ${filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to save artifact file: ${msg}`);
      return {
        success: false,
        error: `Artifact not persisted: ${msg}`,
      };
    }

    let spawnedIds: string[] | undefined;
    const commitResult = await this.withCommittedStateAsync(taskId, async draft => {
      draft.shortArtifactAttempts[draft.currentPhase] = 0;
      draft.artifacts[draft.currentPhase] = artifactContent;
      if (!draft.completedPhases.includes(draft.currentPhase)) {
        draft.completedPhases.push(draft.currentPhase);
      }

      if (draft.currentPhase === 'solution') {
        try {
          const spec = parseGroundingSpec(artifactContent);
          const groundingResult = await runGroundingCheck(spec, 'full');
          draft.groundingCheckAtSolution = {
            capturedAt: new Date().toISOString(),
            stats: groundingResult.stats,
            hasStrongWarning: groundingResult.stats.strongWarnings > 0,
          };
        } catch (err) {
          log.debug('Grounding check at solution submit skipped:', err);
        }
      }

      if (isLastPhase(draft.currentPhase)) {
        draft.status = 'completed';
        try {
          const { emitEpistemicMetricsForCycle } = await import('../../telemetry/epistemicMetrics.js');
          const snapshot = await emitEpistemicMetricsForCycle(draft, draft.projectPath);
          draft.epistemicMetricsAtCompletion = {
            groundedRatio: snapshot.groundedRatio,
            frontierShrinkRate: snapshot.frontierShrinkRate,
            hypothesisRefutationRate: snapshot.hypothesisRefutationRate,
            capturedAt: snapshot.capturedAt,
          };
        } catch (err) {
          log.debug('Epistemic metrics emit skipped:', err);
        }
        return;
      }

      if (draft.currentPhase === 'discovery') {
        try {
          const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
          const memCore = await getMemoryCore();
          const fog = await memCore.getFogOfWar();
          spawnedIds = await spawnReconTasksForBlockingUnknowns(draft, fog);
          if (spawnedIds.length > 0) {
            draft.spawnedReconTaskIds = [...(draft.spawnedReconTaskIds ?? []), ...spawnedIds];
          }
          const counts = summarizeBoundaryCounts(fog);
          draft.frontierSnapshotAtDiscovery = {
            ...counts,
            capturedAt: new Date().toISOString(),
          };
        } catch (err) {
          log.debug('Discovery frontier spawn skipped:', err);
        }
      }

      draft.gateInstructionId = generateGateInstructionId();
      draft.gateInstructionIssuedAt = new Date().toISOString();
      draft.awaitingReflection = true;
    });

    if (this.isPersistFailure(commitResult)) {
      return commitResult;
    }
    const committed = commitResult.committed;

    if (isLastPhase(committed.currentPhase)) {
      const fin = await this.finalizeIntoResponse(committed, this.generateInstruction(committed));
      if (!fin.success) {
        return fin;
      }
      const response: CycleResponse = {
        success: true,
        completed: true,
        cycleStatus: 'completed',
        instruction: fin.instruction!,
      };
      await this.saveIdempotentSnapshot(
        taskId,
        pre.currentPhase,
        'artifact',
        artifactContent,
        response
      );
      return response;
    }

    log.debug(`Phase ${committed.currentPhase} complete, awaiting reflection gate`);

    const fin = await this.finalizeIntoResponse(
      committed,
      await this.buildGateInstruction(committed, spawnedIds)
    );
    if (!fin.success) {
      return fin;
    }
    const response: CycleResponse = {
      success: true,
      instruction: fin.instruction!,
    };
    await this.saveIdempotentSnapshot(
      taskId,
      pre.currentPhase,
      'artifact',
      artifactContent,
      response
    );
    return response;
  }
  
  /**
   * v2: Submit reflection gate response and transition accordingly
   */
  async submitReflection(
    taskId: string,
    reflectionContent: string
  ): Promise<CycleResponse> {
    return this.enqueue(taskId, () =>
      this.submitReflectionInner(taskId, reflectionContent)
    );
  }

  private async submitReflectionInner(
    taskId: string,
    reflectionContent: string
  ): Promise<CycleResponse> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }

    const terminalReflection = this.rejectIfTerminal(state);
    if (terminalReflection) {
      return terminalReflection;
    }

    const replay = this.tryIdempotentReplay(state, 'reflection', reflectionContent);
    if (replay) {
      return replay;
    }
    
    if (!state.awaitingReflection) {
      return { success: false, error: 'Cycle is not awaiting reflection. Submit an artifact first.' };
    }

    const gateCheck = validateGateInstructionId(state.gateInstructionId, reflectionContent);
    if (!gateCheck.valid) {
      const fin = await this.finalizeIntoResponse(
        state,
        await this.buildGateInstruction(state)
      );
      if (!fin.success) {
        return fin;
      }
      return {
        success: false,
        error: gateCheck.error,
        instruction: fin.instruction,
      };
    }
    
    // Parse reflection from content. A malformed reflection is rejected before
    // any state mutation, so the cycle stays at the same gate with the same ID.
    const parsedReflection = this.parseReflection(state.currentPhase, reflectionContent);
    if (!parsedReflection.ok) {
      log.warn(`Reflection rejected (phase: ${state.currentPhase}): ${parsedReflection.reason}`);
      const fin = await this.finalizeIntoResponse(
        state,
        await this.buildGateInstruction(state)
      );
      if (!fin.success) {
        return fin;
      }
      return {
        success: false,
        error:
          `Reflection rejected: ${parsedReflection.reason}. ` +
          'The cycle is still awaiting reflection for the same Gate-ID. ' +
          'Resubmit a ```json block with gate_instruction_id, decision (continue | pivot | rewind | abort), summary and confidence.',
        instruction: fin.instruction,
      };
    }
    const reflection = parsedReflection.reflection;

    const reflectionCommit = await this.withCommittedState(taskId, draft => {
      draft.reflections.push(reflection);
      draft.awaitingReflection = false;
      draft.gateInstructionId = undefined;
      draft.gateInstructionIssuedAt = undefined;
    });
    if (this.isPersistFailure(reflectionCommit)) {
      return reflectionCommit;
    }
    const afterReflection = reflectionCommit.committed;

    await this.appendReflectionToArtifact(afterReflection, reflection);
    await this.logReflection(afterReflection, reflection);
    
    log.debug(`Reflection gate: ${reflection.decision} (phase: ${afterReflection.currentPhase}, confidence: ${reflection.confidence})`);
    
    // Safeguard: store pivot/abort decisions in L2 memory
    if (reflection.decision === 'pivot' || reflection.decision === 'abort') {
      try {
        const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
        const memCore = await getMemoryCore();
        await memCore.store(
          `[${reflection.decision.toUpperCase()}] Task: ${afterReflection.taskDescription.substring(0, 100)}. Phase: ${afterReflection.currentPhase}. Reason: ${reflection.summary}`,
          {
            level: 'L2',
            source: 'runtime',
            contextKeys: [taskId, afterReflection.currentPhase, reflection.decision],
            confidence: 0.9,
          }
        );
        log.info(`Stored ${reflection.decision} decision in L2 memory`);
      } catch (err) {
        log.debug('Memory store on pivot/abort failed:', err);
      }
    }

    const reflectionPhase = state.currentPhase;

    switch (reflection.decision) {
      case 'continue': {
        const r = await this.transitionToNextPhase(taskId);
        if (r.success) {
          await this.saveIdempotentSnapshot(
            taskId,
            reflectionPhase,
            'reflection',
            reflectionContent,
            r
          );
        }
        return r;
      }
      
      case 'pivot':
        if (reflection.taskFramingUpdate) {
          const pivotResult = await this.withCommittedState(taskId, draft => {
            draft.taskFraming = reflection.taskFramingUpdate!;
          });
          if (this.isPersistFailure(pivotResult)) {
            return pivotResult;
          }
          log.debug(`Task framing updated: ${reflection.taskFramingUpdate.substring(0, 80)}...`);
        }
        {
          const r = await this.transitionToNextPhase(taskId);
          if (r.success) {
            await this.saveIdempotentSnapshot(
              taskId,
              reflectionPhase,
              'reflection',
              reflectionContent,
              r
            );
          }
          return r;
        }
      
      case 'rewind': {
        const target = reflection.rewindTarget || this.getPreviousPhase(afterReflection.currentPhase);
        if (!target) {
          const r = await this.transitionToNextPhase(taskId);
          if (r.success) {
            await this.saveIdempotentSnapshot(
              taskId,
              reflectionPhase,
              'reflection',
              reflectionContent,
              r
            );
          }
          return r;
        }
        const r = await this.rewindToPhase(taskId, target);
        if (r.success) {
          await this.saveIdempotentSnapshot(
            taskId,
            reflectionPhase,
            'reflection',
            reflectionContent,
            r
          );
        }
        return r;
      }
      
      case 'abort': {
        const abortCommit = await this.withCommittedState(taskId, draft => {
          draft.status = 'aborted';
        });
        if (this.isPersistFailure(abortCommit)) {
          return abortCommit;
        }
        const afterAbort = abortCommit.committed;
        const fin = await this.finalizeIntoResponse(
          afterAbort,
          this.generateInstruction(afterAbort)
        );
        if (!fin.success) {
          return fin;
        }
        const response: CycleResponse = {
          success: true,
          completed: true,
          cycleStatus: 'aborted',
          instruction: fin.instruction!,
        };
        await this.saveIdempotentSnapshot(
          taskId,
          reflectionPhase,
          'reflection',
          reflectionContent,
          response
        );
        return response;
      }
      
      default: {
        // validateDecision() guarantees the union is exhausted above.
        const unreachable: never = reflection.decision;
        return { success: false, error: `Unhandled reflection decision: ${String(unreachable)}` };
      }
    }
  }
  
  /**
   * Get current instruction without submitting artifact.
   * v2: Returns gate instruction when awaiting reflection.
   */
  async getCurrentInstruction(taskId: string): Promise<CycleResponse> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    
    // v2: If awaiting reflection, return gate instruction
    if (state.awaitingReflection) {
      const fin = await this.finalizeIntoResponse(
        state,
        await this.buildGateInstruction(state)
      );
      if (!fin.success) {
        return fin;
      }
      return {
        success: true,
        instruction: fin.instruction!,
      };
    }
    
    const fin = await this.finalizeIntoResponse(state, this.generateInstruction(state));
    if (!fin.success) {
      return fin;
    }
    return {
      success: true,
      instruction: fin.instruction!,
    };
  }
  
  /**
   * List all active cycles
   */
  async listActiveCycles(): Promise<Array<{ taskId: string; description: string; phase: PhaseType; progress: number }>> {
    const cycles: Array<{ taskId: string; description: string; phase: PhaseType; progress: number }> = [];
    
    // From memory
    for (const state of this.cycles.values()) {
      cycles.push({
        taskId: state.taskId,
        description: state.taskDescription,
        phase: state.currentPhase,
        progress: Math.round((state.completedPhases.length / 7) * 100)
      });
    }
    
    return cycles;
  }
  
  // ───── v2: Reflection Gate helpers ─────
  
  /**
   * Transition to the next phase after successful gate
   */
  private async transitionToNextPhase(taskId: string): Promise<CycleResponse> {
    let cycleCompleted = false;
    const result = await this.withCommittedState(taskId, draft => {
      const nextPhase = getNextPhase(draft.currentPhase);
      if (!nextPhase) {
        cycleCompleted = true;
        draft.status = 'completed';
        return;
      }
      draft.currentPhase = nextPhase;
      resetPhaseMcpTracking(draft);
      draft.phaseEnteredAt = new Date().toISOString();
    });
    if (this.isPersistFailure(result)) {
      return result;
    }
    const state = result.committed;

    if (cycleCompleted) {
      const fin = await this.finalizeIntoResponse(state, this.generateInstruction(state));
      if (!fin.success) {
        return fin;
      }
      return {
        success: true,
        completed: true,
        cycleStatus: 'completed',
        instruction: fin.instruction!,
      };
    }

    log.debug(`Transitioned to phase: ${state.currentPhase}`);
    const fin = await this.finalizeIntoResponse(state, this.generateInstruction(state));
    if (!fin.success) {
      return fin;
    }
    return {
      success: true,
      instruction: fin.instruction!,
    };
  }
  
  /**
   * Rewind to an earlier phase. Removes later phases from completedPhases.
   * Max 2 rewinds per phase to prevent infinite loops.
   */
  private async rewindToPhase(taskId: string, target: PhaseType): Promise<CycleResponse> {
    const current = await this.getState(taskId);
    if (!current) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }

    const targetOrder = PHASE_CONFIGS[target].order;

    if (targetOrder >= PHASE_CONFIGS[current.currentPhase].order) {
      return this.transitionToNextPhase(taskId);
    }

    const nextRewinds = (current.rewindCount[target] || 0) + 1;
    if (nextRewinds > CycleOrchestrator.MAX_REWINDS_PER_TARGET) {
      log.warn(`Max rewinds reached for ${target}, forcing continue`);
      return this.transitionToNextPhase(taskId);
    }

    const result = await this.withCommittedState(taskId, draft => {
      draft.rewindCount[target] = nextRewinds;
      draft.completedPhases = draft.completedPhases.filter(p => {
        return PHASE_CONFIGS[p].order < targetOrder;
      });
      draft.currentPhase = target;
      resetPhaseMcpTracking(draft);
      draft.phaseEnteredAt = new Date().toISOString();
    });
    if (this.isPersistFailure(result)) {
      return result;
    }
    const state = result.committed;

    log.debug(`Rewound to phase: ${target}`);

    const fin = await this.finalizeIntoResponse(state, this.generateInstruction(state));
    if (!fin.success) {
      return fin;
    }
    return {
      success: true,
      instruction: fin.instruction!,
    };
  }
  
  /**
   * Generate reflection gate instruction after a phase completes
   */
  private async buildGateInstruction(
    state: CycleState,
    spawnedIds?: string[]
  ): Promise<CycleInstruction> {
    const config = getPhaseConfig(state.currentPhase);
    const nextPhase = getNextPhase(state.currentPhase);
    const weight = getGateWeight(state.currentPhase, nextPhase);
    let gateTemplate = generateGateTemplate(state.currentPhase, weight, state.taskFraming);

    if (state.currentPhase === 'discovery') {
      try {
        const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
        const memCore = await getMemoryCore();
        const fog = await memCore.getFogOfWar();
        const report = buildFrontierReport(fog);
        const ids = spawnedIds ?? state.spawnedReconTaskIds ?? [];
        const discoveryExtension = generateDiscoveryGateExtension(report, ids);
        gateTemplate = `${discoveryExtension}\n\n${gateTemplate}`;
      } catch (err) {
        log.debug('Discovery frontier report skipped:', err);
      }
    }

    if (state.currentPhase === 'solution') {
      try {
        const spec = parseGroundingSpec(state.artifacts.solution ?? '');
        const result = await runGroundingCheck(spec, 'full');
        const report = buildGroundingReport(result);
        const extension = generateGroundingGateExtension(
          report,
          'full',
          result.stats.strongWarnings > 0
        );
        gateTemplate = `${extension}\n\n${gateTemplate}`;
        const adversarialExtension = generateAdversarialGateExtension(
          state.artifacts.solution ?? ''
        );
        gateTemplate = `${adversarialExtension}\n\n${gateTemplate}`;
      } catch (err) {
        log.debug('Solution grounding report skipped:', err);
      }
    }

    if (state.currentPhase === 'simulation') {
      try {
        const spec = parseGroundingSpec(state.artifacts.solution ?? '');
        const result = await runGroundingCheck(spec, 'light');
        if (result.stats.strongWarnings > 0) {
          const report = buildGroundingReport(result);
          const extension = generateGroundingGateExtension(report, 'light', true);
          gateTemplate = `${extension}\n\n${gateTemplate}`;
        }
      } catch (err) {
        log.debug('Simulation grounding re-check skipped:', err);
      }
    }

    if (state.gateInstructionId) {
      gateTemplate = `${formatGateIdBlock(state.gateInstructionId)}\n\n${gateTemplate}`;
    }

    const artifactsDir = `${CYCLES_DIR}/${state.taskSlug}`;
    const filename = this.getArtifactFilename(state.currentPhase);
    
    return {
      taskId: state.taskId,
      phase: {
        name: state.currentPhase,
        order: config.order,
        goal: `Reflection Gate: ${state.currentPhase.toUpperCase()} завершён`,
        nonGoals: ['Следующая фаза — после рефлексии по текущей'],
        attentionLock: `🔄 Фокус: рефлексия по результатам ${state.currentPhase.toUpperCase()}`
      },
      progress: {
        completed: state.completedPhases.length,
        total: 7,
        percentage: Math.round((state.completedPhases.length / 7) * 100)
      },
      artifact: {
        filename,
        path: `${artifactsDir}/${filename}`,
        template:
          `Artifact \`${filename}\` is saved on disk. Complete the **Reflection Gate** section in the MCP response (single copy of the JSON template).`,
      },
      instruction: `📄 **Артефакт сохранён:** \`${artifactsDir}/${filename}\`
${this.extractBriefSummary(state.artifacts[state.currentPhase])}

Фаза ${state.currentPhase.toUpperCase()} завершена. Пройдите Reflection Gate (${weight}). Полный текст gate — **один раз** в секции «Reflection Gate» ответа \`mcp_m7_cycle\` (GATE-3).

${this.buildCarryForward(state)}

Ответьте JSON блоком, затем вызовите:
\`\`\`
mcp_m7_cycle task_id="${state.taskId}" artifact_content="<ваш reflection JSON>"
\`\`\``,
      nextCall: `mcp_m7_cycle task_id="${state.taskId}" artifact_content="<reflection JSON>"`,
      gate: {
        weight,
        prompt: gateTemplate
      }
    };
  }
  
  /**
   * Extract a 2-3 line summary from artifact content for quick orientation.
   * Picks the first meaningful non-header lines after the first heading.
   */
  private extractBriefSummary(artifactContent: string | null | undefined): string {
    if (!artifactContent) return '';

    const lines = artifactContent.split('\n');
    const meaningful: string[] = [];
    let pastFirstSection = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        pastFirstSection = true;
        continue;
      }
      if (line.startsWith('---') || line.startsWith('|') || line.startsWith('```')) continue;
      if (/^\*\*(?:Phase|Cycle|Date|Task|ID):/i.test(line)) continue;
      if (line.startsWith('- [ ]') || line.startsWith('- [x]')) continue;
      if (/^(?:from |import |def |class |const |let |var |function |return |if |for |while |try |catch )/.test(line)) continue;
      if (line.length < 10) continue;
      if (!pastFirstSection) continue;

      meaningful.push(line.length > 120 ? line.substring(0, 117) + '...' : line);
      if (meaningful.length >= 3) break;
    }

    if (meaningful.length === 0) return '';
    return `\n> ${meaningful.join('\n> ')}\n`;
  }

  /**
   * Parse reflection JSON from content (may be wrapped in a markdown code block).
   * Returns ok:false when the content is not JSON, not an object, or has no
   * recognised decision. No default decision is ever substituted: the caller
   * must reject the submission and keep the cycle at the current gate.
   */
  private parseReflection(phase: PhaseType, content: string): ParsedReflection {
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `reflection is not valid JSON (${message})` };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'reflection JSON must be an object' };
    }
    const obj = parsed as Record<string, unknown>;

    const decision = this.validateDecision(obj.decision);
    if (!decision) {
      return {
        ok: false,
        reason: `unknown decision ${JSON.stringify(obj.decision ?? null)}; expected one of continue, pivot, rewind, abort`,
      };
    }

    return {
      ok: true,
      reflection: {
        phase,
        decision,
        changeDetected: Boolean(obj.change_detected),
        summary: String(obj.summary || ''),
        taskFramingUpdate: obj.task_framing_update ? String(obj.task_framing_update) : undefined,
        rewindTarget: obj.rewind_target ? this.validatePhase(obj.rewind_target) : undefined,
        confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
        timestamp: new Date().toISOString(),
      },
    };
  }
  
  /** Returns null for anything that is not one of the four known decisions. */
  private validateDecision(raw: unknown): ReflectionDecision | null {
    if (typeof raw !== 'string') return null;
    const valid: ReflectionDecision[] = ['continue', 'pivot', 'rewind', 'abort'];
    const str = raw.toLowerCase().trim();
    return valid.includes(str as ReflectionDecision) ? (str as ReflectionDecision) : null;
  }
  
  private validatePhase(raw: unknown): PhaseType | undefined {
    const str = String(raw).toLowerCase().trim();
    const phases: PhaseType[] = ['intake', 'discovery', 'architecture', 'solution', 'impact', 'simulation', 'implementation'];
    return phases.includes(str as PhaseType) ? (str as PhaseType) : undefined;
  }
  
  private getPreviousPhase(current: PhaseType): PhaseType | null {
    const order = PHASE_CONFIGS[current].order;
    if (order <= 1) return null;
    const prev = Object.values(PHASE_CONFIGS).find(p => p.order === order - 1);
    return prev?.name ?? null;
  }
  
  /**
   * Append reflection section to the phase artifact file on disk
   */
  private async appendReflectionToArtifact(state: CycleState, reflection: ReflectionGate): Promise<void> {
    const artifactsDir = this.artifactsDirForState(state);
    const filename = this.getArtifactFilename(reflection.phase);
    const filePath = path.join(artifactsDir, filename);
    
    const section = `

---

## Reflection Gate

- **Decision:** ${reflection.decision.toUpperCase()}
- **Change detected:** ${reflection.changeDetected ? 'yes' : 'no'}
- **Summary:** ${reflection.summary}
${reflection.taskFramingUpdate ? `- **Task framing update:** ${reflection.taskFramingUpdate}` : ''}${reflection.rewindTarget ? `- **Rewind target:** ${reflection.rewindTarget}` : ''}
- **Confidence:** ${reflection.confidence}
- **Timestamp:** ${reflection.timestamp}
`;
    
    try {
      await fs.appendFile(filePath, section, 'utf-8');
      log.debug(`Appended reflection to ${filename}`);
    } catch (err) {
      log.warn(`Failed to append reflection to artifact: ${err}`);
    }
  }
  
  /**
   * Append reflection entry to REFLECTION_LOG.json (JSON lines format)
   */
  private async logReflection(state: CycleState, reflection: ReflectionGate): Promise<void> {
    const logDir = this.cyclesDirForProject(state.projectPath);
    const logPath = path.join(logDir, `${state.taskId}_REFLECTION_LOG.jsonl`);
    
    const entry = JSON.stringify({
      taskId: state.taskId,
      ...reflection
    }) + '\n';
    
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(logPath, entry, 'utf-8');
    } catch (err) {
      log.warn(`Failed to write reflection log: ${err}`);
    }
  }
  
  /**
   * Check if state needs migration (backward compat for pre-v2 states)
   */
  private migrateState(state: CycleState): CycleState {
    if (state.awaitingReflection === undefined) {
      state.awaitingReflection = false;
    }
    if (!state.taskFraming) {
      state.taskFraming = state.taskDescription;
    }
    if (!Array.isArray(state.reflections)) {
      state.reflections = [];
    }
    if (!state.status) {
      state.status =
        state.completedPhases.length >= 7 ? 'completed' : ('active' as CycleStatus);
    }
    if (!state.phaseAttempts) {
      state.phaseAttempts = zeroPhaseCounters();
    }
    if (!state.shortArtifactAttempts) {
      state.shortArtifactAttempts = zeroPhaseCounters();
    }
    if (!state.rewindCount) {
      state.rewindCount = zeroPhaseCounters();
    }
    if (!state.projectPath) {
      state.projectPath = getProjectPath();
    }
    return state;
  }

  private hashSubmitContent(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private tryIdempotentReplay(
    state: CycleState,
    kind: CycleSubmitKind,
    content: string
  ): CycleResponse | null {
    const la = state.lastAccepted;
    if (!la || !state.lastSuccessfulResponse) {
      return null;
    }
    // A retry of the last accepted call matches by content only: after an accepted reflection the
    // phase has moved on and cycleTool routes the retried JSON to submitArtifact.
    if (la.sha256 !== this.hashSubmitContent(content)) {
      return null;
    }
    log.debug(`CYC-2: idempotent replay of ${la.kind} (submitted as ${kind}) from phase ${la.phase}`);
    return structuredClone(state.lastSuccessfulResponse);
  }

  private enqueue<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.taskQueues.get(taskId) ?? Promise.resolve();
    const tail = previous.then(
      () => fn(),
      () => fn()
    );
    this.taskQueues.set(taskId, tail);
    void tail.finally(() => {
      if (this.taskQueues.get(taskId) === tail) {
        this.taskQueues.delete(taskId);
      }
    });
    return tail;
  }

  private async saveIdempotentSnapshot(
    taskId: string,
    phase: PhaseType,
    kind: CycleSubmitKind,
    content: string,
    response: CycleResponse
  ): Promise<void> {
    const sha256 = this.hashSubmitContent(content);
    const snap = structuredClone(response);
    const result = await this.withCommittedState(taskId, draft => {
      draft.lastAccepted = { phase, kind, sha256 };
      draft.lastSuccessfulResponse = snap;
    });
    if (this.isPersistFailure(result)) {
      log.warn(`CYC-2: failed to persist idempotent snapshot for ${taskId}`);
    }
  }

  /**
   * CYC-7: first write uses template header; resubmits append with timestamp separator.
   */
  private async writePhaseArtifactFile(
    filePath: string,
    state: CycleState,
    artifactContent: string
  ): Promise<void> {
    let exists = false;
    try {
      await fs.access(filePath);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      const fileContent = this.ensureTemplateHeader(state, artifactContent);
      await fs.writeFile(filePath, fileContent, 'utf-8');
      return;
    }

    const separator = `\n\n---\n<!-- resubmitted ${new Date().toISOString()} -->\n\n`;
    await fs.appendFile(filePath, separator + artifactContent, 'utf-8');
  }

  /**
   * Ensure artifact file has a template header for human readability.
   * If AI already provided a header (starts with '# '), use as-is.
   * Otherwise, prepend the phase template header (title + focus section).
   */
  private ensureTemplateHeader(state: CycleState, artifactContent: string): string {
    if (artifactContent.trimStart().startsWith('# ')) {
      return artifactContent;
    }
    
    const config = getPhaseConfig(state.currentPhase);
    const templateLines = config.artifactTemplate.split('\n');
    const firstSectionIdx = templateLines.findIndex((line, i) => i > 0 && line.startsWith('## '));
    const headerLines = firstSectionIdx > 0 
      ? templateLines.slice(0, firstSectionIdx) 
      : templateLines.slice(0, 10);
    const header = headerLines
      .join('\n')
      .replace(/{task}/g, state.taskDescription)
      .replace(/{taskId}/g, state.taskId)
      .replace(/{date}/g, new Date().toISOString().split('T')[0]);
    
    return header + '\n\n' + artifactContent;
  }

  /**
   * CYC-6: Most recent gate decision for a phase (after rewind/redo, last push wins).
   */
  private latestReflectionForPhase(
    reflections: ReflectionGate[],
    phase: PhaseType
  ): ReflectionGate | undefined {
    for (let i = reflections.length - 1; i >= 0; i--) {
      if (reflections[i].phase === phase) {
        return reflections[i];
      }
    }
    return undefined;
  }

  /**
   * Build carry-forward context from completed phases and their reflections.
   * Gives AI context about what happened so far, even in a new chat session.
   */
  private buildCarryForward(state: CycleState): string {
    if (state.completedPhases.length === 0) return '';
    
    const artifactsDir = `${CYCLES_DIR}/${state.taskSlug}`;
    const rows: string[] = [];
    for (const phase of state.completedPhases) {
      const reflection = this.latestReflectionForPhase(state.reflections, phase);
      const decision = reflection?.decision?.toUpperCase() || '-';
      const summary = reflection?.summary 
        || this.extractBriefSummary(state.artifacts[phase])?.replace(/^> /gm, '').substring(0, 120)
        || '';
      const artifactFile = `${artifactsDir}/${this.getArtifactFilename(phase)}`;
      rows.push(`| ${phase.toUpperCase()} | ${decision} | ${summary} | \`${artifactFile}\` |`);
    }
    
    return [
      CONTROL_CHANNEL_CARRY_FORWARD,
      '',
      '## 📝 Previous Phases',
      '',
      '| Phase | Gate | Key Finding | Artifact |',
      '|-------|------|-------------|----------|',
      ...rows,
      ''
    ].join('\n');
  }

  /**
   * Build a compact list of artifact file links for completed phases.
   * Shown at the start of each new phase so the user can open/read them.
   */
  private buildArtifactLinks(state: CycleState, artifactsDir: string): string {
    if (state.completedPhases.length === 0) return '';

    const links = state.completedPhases.map(phase => {
      const file = this.getArtifactFilename(phase);
      return `- ${phase.toUpperCase()}: \`${artifactsDir}/${file}\``;
    });

    return [
      '## 📂 Артефакты цикла',
      '',
      ...links,
      '',
      ''
    ].join('\n');
  }

  /**
   * Sprint 8: track MCP calls per phase and append rule reinjection when threshold hit.
   */
  private async finalizeInstruction(
    state: CycleState,
    instruction: CycleInstruction
  ): Promise<CycleInstruction | CycleResponse> {
    const draft = structuredClone(state);
    const track = trackPhaseMcpCall(draft);
    draft.lastUpdatedAt = new Date().toISOString();
    try {
      await this.commitState(draft);
    } catch (err) {
      return this.persistErrorResponse(err);
    }

    if (track.shouldReinject) {
      const block = buildRuleReinjectionBlock(draft, getPhaseConfig(draft.currentPhase));
      instruction.instruction = appendRuleReinjection(instruction.instruction, block);
    }

    return instruction;
  }

  private async finalizeIntoResponse(
    state: CycleState,
    instruction: CycleInstruction
  ): Promise<CycleResponse> {
    const result = await this.finalizeInstruction(state, instruction);
    if ('success' in result && result.success === false) {
      return result;
    }
    return { success: true, instruction: result as CycleInstruction };
  }

  private cycleStatePath(taskId: string): string {
    return path.join(this.cyclesDir, `${taskId}.json`);
  }

  private persistErrorResponse(err: unknown): CycleResponse {
    const msg =
      err instanceof StatePersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { success: false, error: `State not persisted: ${msg}` };
  }

  private isPersistFailure(
    result: CycleResponse | { committed: CycleState }
  ): result is CycleResponse {
    return 'success' in result && result.success === false;
  }

  private async commitState(next: CycleState): Promise<void> {
    const cyclesDir = this.cyclesDirForProject(next.projectPath);
    await fs.mkdir(cyclesDir, { recursive: true });
    const statePath = this.cycleStatePathFor(next.projectPath, next.taskId);
    const result = await atomicWriteJSON(statePath, next);
    if (!result.success) {
      throw new StatePersistError(statePath, result.error ?? 'unknown error');
    }
    this.cycles.set(next.taskId, next);
    this.taskProjectRoots.set(next.taskId, next.projectPath);
  }

  private async withCommittedState(
    taskId: string,
    mutate: (draft: CycleState) => void
  ): Promise<CycleResponse | { committed: CycleState }> {
    const current = await this.getState(taskId);
    if (!current) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    const draft = structuredClone(current);
    mutate(draft);
    draft.lastUpdatedAt = new Date().toISOString();
    try {
      await this.commitState(draft);
    } catch (err) {
      return this.persistErrorResponse(err);
    }
    return { committed: draft };
  }

  private async withCommittedStateAsync(
    taskId: string,
    mutate: (draft: CycleState) => Promise<void>
  ): Promise<CycleResponse | { committed: CycleState }> {
    const current = await this.getState(taskId);
    if (!current) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    const draft = structuredClone(current);
    await mutate(draft);
    draft.lastUpdatedAt = new Date().toISOString();
    try {
      await this.commitState(draft);
    } catch (err) {
      return this.persistErrorResponse(err);
    }
    return { committed: draft };
  }

  /**
   * Generate instruction for current phase
   */
  private generateInstruction(state: CycleState): CycleInstruction {
    const config = getPhaseConfig(state.currentPhase);
    const artifactsDir = `${CYCLES_DIR}/${state.taskSlug}`;
    const filename = this.getArtifactFilename(state.currentPhase);
    
    // Fill template with task info
    const template = config.artifactTemplate
      .replace(/{task}/g, state.taskDescription)
      .replace(/{taskId}/g, state.taskId)
      .replace(/{date}/g, new Date().toISOString().split('T')[0]);
    
    return {
      taskId: state.taskId,
      phase: {
        name: state.currentPhase,
        order: config.order,
        goal: config.goal,
        nonGoals: config.nonGoals,
        attentionLock: config.attentionLock
      },
      progress: {
        completed: state.completedPhases.length,
        total: 7,
        percentage: Math.round((state.completedPhases.length / 7) * 100)
      },
      artifact: {
        filename,
        path: `${artifactsDir}/${filename}`,
        template
      },
      instruction: this.formatInstructionText(state, config, artifactsDir, filename),
      nextCall: `mcp_m7_cycle task_id="${state.taskId}" artifact_content="<содержимое ${filename}>"`
    };
  }
  
  private formatInstructionText(
    state: CycleState,
    config: typeof PHASE_CONFIGS.intake,
    artifactsDir: string,
    filename: string
  ): string {
    const progressBar = this.generateProgressBar(state.completedPhases.length, 7);
    const carryForward = this.buildCarryForward(state);
    const artifactLinks = this.buildArtifactLinks(state, artifactsDir);
    
    return `
${carryForward}${artifactLinks}ℹ️ Следуй структуре шаблона. Заполни КАЖДУЮ секцию отдельно — это документация, не data dump.

📄 **Текущий артефакт:** \`${artifactsDir}/${filename}\`

Используй предоставленный шаблон. Заполни ВСЕ секции.

После создания файла вызови:
\`\`\`
mcp_m7_cycle task_id="${state.taskId}" artifact_content="[полное содержимое ${filename}]"
\`\`\`

${progressBar}`.trim();
  }
  
  private generateProgressBar(completed: number, total: number): string {
    const filled = '█'.repeat(completed * 2);
    const empty = '░'.repeat((total - completed) * 2);
    return `Progress: ${filled}${empty} ${completed}/${total}`;
  }
  
  private getArtifactFilename(phase: PhaseType): string {
    const names: Record<PhaseType, string> = {
      intake: 'INTAKE.md',
      discovery: 'DISCOVERY.md',
      architecture: 'ARCHITECTURE.md',
      solution: 'SOLUTION_PLAN.md',
      impact: 'IMPACT_ANALYSIS.md',
      simulation: 'SIMULATION.md',
      implementation: 'IMPLEMENTATION.md'
    };
    return names[phase];
  }
  
  private generateTaskId(description: string, suffix: string): string {
    let slug = description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);
    if (!slug) {
      slug = createHash('sha1').update(description).digest('hex').slice(0, 8);
    }
    return `cycle_${slug}_${suffix}`;
  }
  
  private generateSlug(description: string): string {
    // Any script; an empty slug would put the artifacts straight into m7-cycles/ (HYG-1)
    const normalized = description
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const slug = Array.from(normalized).slice(0, 50).join('').replace(/^-+|-+$/g, '');
    return slug || createHash('sha1').update(description).digest('hex').slice(0, 8);
  }
  
  private async getState(taskId: string): Promise<CycleState | null> {
    if (this.cycles.has(taskId)) {
      return this.migrateState(this.cycles.get(taskId)!);
    }

    const candidatePaths: string[] = [];
    const mappedRoot = this.taskProjectRoots.get(taskId);
    if (mappedRoot) {
      candidatePaths.push(this.cycleStatePathFor(mappedRoot, taskId));
    }
    candidatePaths.push(this.cycleStatePath(taskId));
    candidatePaths.push(this.cycleStatePathFor(getProjectPath(), taskId));

    const seen = new Set<string>();
    for (const statePath of candidatePaths) {
      if (seen.has(statePath)) continue;
      seen.add(statePath);

      const { data, recoveredFrom } = await safeReadJSON<CycleState>(statePath);
      if (!data) {
        continue;
      }
      if (recoveredFrom) {
        log.info(`Cycle state recovered from ${recoveredFrom}`);
      }
      if (!data.projectPath) {
        data.projectPath = this.projectRootFromStateFile(statePath);
      }
      const state = this.migrateState(data);
      this.cycles.set(taskId, state);
      this.taskProjectRoots.set(taskId, state.projectPath);
      return state;
    }

    return null;
  }

  /**
   * Register a 4-5 word summary for a completed cycle and append to CYCLE_REGISTRY.md
   */
  async registerSummary(taskId: string, summary: string): Promise<{ success: boolean; entry?: string; error?: string }> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    
    const registryPath = path.join(state.projectPath, 'CYCLE_REGISTRY.md');
    
    const type = state.taskSlug.startsWith('feat') ? 'feat' : 'cycle';
    const folder = `${CYCLES_DIR}/${state.taskSlug}`;
    const phases = `${state.completedPhases.length}/7`;
    const date = new Date().toISOString().slice(5, 10); // MM-DD
    const statusTag = state.status ?? 'active';
    
    // Read current registry to find next number
    let nextNum = 1;
    let registryContent = '';
    try {
      registryContent = await fs.readFile(registryPath, 'utf-8');
      const numMatches = registryContent.match(/^\| (\d+) \|/gm);
      if (numMatches && numMatches.length > 0) {
        const nums = numMatches.map(m => parseInt(m.replace(/^\| /, '').replace(/ \|$/, '')));
        nextNum = Math.max(...nums) + 1;
      }
    } catch {
      // Registry doesn't exist yet — create it
      registryContent = `# M7 Cycle Registry\n\n| # | Date | Type | Phases | Summary | Folder |\n|---|------|------|--------|---------|--------|\n`;
    }
    
    const entry = `| ${nextNum} | ${date} | ${type} | ${phases} | ${summary} [${statusTag}] | ${folder} |`;
    const folderNeedle = `| ${folder} |`;

    const lines = registryContent.split('\n');
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('| ') || !lines[i].includes(folderNeedle)) {
        continue;
      }
      const numMatch = lines[i].match(/^\| (\d+) \|/);
      const rowNum = numMatch ? numMatch[1] : String(nextNum);
      lines[i] = `| ${rowNum} | ${date} | ${type} | ${phases} | ${summary} [${statusTag}] | ${folder} |`;
      replaced = true;
      break;
    }

    if (replaced) {
      registryContent = lines.join('\n');
    } else {
      const adrIndex = registryContent.indexOf('\n## ADR');
      if (adrIndex > -1) {
        registryContent = registryContent.slice(0, adrIndex) + entry + '\n' + registryContent.slice(adrIndex);
      } else {
        registryContent = registryContent.trimEnd() + '\n' + entry + '\n';
      }
    }
    
    await fs.writeFile(registryPath, registryContent, 'utf-8');
    log.debug(`Registered summary #${nextNum}: "${summary}" for ${taskId}`);
    
    return { success: true, entry };
  }
  
  private async folderExists(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}

// Singleton instance
let instance: CycleOrchestrator | null = null;

export function getCycleOrchestrator(): CycleOrchestrator {
  if (!instance) {
    instance = new CycleOrchestrator();
  }
  return instance;
}
