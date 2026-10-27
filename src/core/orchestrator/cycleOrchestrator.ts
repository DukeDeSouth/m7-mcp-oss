/**
 * M7 Cycle Orchestrator
 * 
 * Manages M7 cycle state and provides explicit instructions for AI.
 * This is the core component of the "MCP as Orchestrator" pattern.
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../utils/projectPath.js';
const CYCLES_DIR = 'm7-cycles';
import {
  CycleState,
  CycleInstruction,
  PhaseType,
  CycleResponse,
  ReflectionGate,
  ReflectionDecision,
  GateWeight
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

export class CycleOrchestrator {
  private cycles: Map<string, CycleState> = new Map();
  private cyclesDir: string;
  
  constructor() {
    const projectPath = getProjectPath();
    this.cyclesDir = path.join(projectPath, '.m7', 'cycles');
  }
  
  /**
   * Remove cycle state files older than 7 days
   */
  private async cleanupOldCycles(): Promise<void> {
    try {
      await fs.mkdir(this.cyclesDir, { recursive: true });
      const files = await fs.readdir(this.cyclesDir);
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
        const filePath = path.join(this.cyclesDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            // v9.1: Also remove from in-memory Map to prevent unbounded growth
            const cycleId = file.replace(/\.(json|jsonl)$/, '');
            this.cycles.delete(cycleId);
            log.debug(`Cleaned up old cycle file: ${file}`);
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
    } catch {
      // Non-critical — silently ignore cleanup failures
    }
  }

  /**
   * Start a new M7 cycle
   */
  async startCycle(description: string): Promise<CycleInstruction> {
    // Cleanup old cycle state files on each new cycle start
    await this.cleanupOldCycles();
    const taskId = this.generateTaskId(description);
    const taskSlug = this.generateSlug(description);
    
    const state: CycleState = {
      taskId,
      taskSlug,
      taskDescription: description,
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
      phaseAttempts: {
        intake: 0,
        discovery: 0,
        architecture: 0,
        solution: 0,
        impact: 0,
        simulation: 0,
        implementation: 0
      },
      // v2: Reflection Gates
      awaitingReflection: false,
      taskFraming: description,
      reflections: [],
      phaseMcpCallCount: 0,
      phaseEnteredAt: new Date().toISOString(),
    };
    
    // Save state
    this.cycles.set(taskId, state);
    await this.saveState(state);
    
    // Create artifacts directory
    const artifactsDir = path.join(getProjectPath(), CYCLES_DIR, taskSlug);
    await fs.mkdir(artifactsDir, { recursive: true });
    
    log.debug(`Started M7 Cycle: ${taskId}`);
    
    return this.finalizeInstruction(state, this.generateInstruction(state));
  }
  
  /**
   * Submit artifact and get next instruction
   */
  async submitArtifact(
    taskId: string,
    artifactContent: string
  ): Promise<CycleResponse> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    
    // Validate artifact (basic length check)
    const minLength = 100;
    if (!artifactContent || artifactContent.trim().length < minLength) {
      state.phaseAttempts[state.currentPhase]++;
      await this.saveState(state);
      
      // Loop prevention - max 3 attempts per phase
      if (state.phaseAttempts[state.currentPhase] >= 3) {
        log.warn(`Loop detected in ${state.currentPhase} for ${taskId}, forcing transition`);
        // Force transition anyway to prevent infinite loops
      } else {
        return {
          success: false,
          error: `Artifact too short (${artifactContent.trim().length} chars). Minimum ${minLength} chars required. Attempt ${state.phaseAttempts[state.currentPhase]}/3.`
        };
      }
    }
    
    // Store artifact content
    state.artifacts[state.currentPhase] = artifactContent;
    state.completedPhases.push(state.currentPhase);
    
    // Save artifact file to disk with template header for human readability
    const artifactsDir = path.join(getProjectPath(), CYCLES_DIR, state.taskSlug);
    const filename = this.getArtifactFilename(state.currentPhase);
    
    try {
      await fs.mkdir(artifactsDir, { recursive: true });
      
      // Prepend template header if AI didn't include one
      const fileContent = this.ensureTemplateHeader(state, artifactContent);
      
      await fs.writeFile(
        path.join(artifactsDir, filename),
        fileContent,
        'utf-8'
      );
      log.debug(`Saved artifact: ${filename}`);
    } catch (err) {
      log.warn(`Failed to save artifact file: ${err}`);
    }
    
    // Grounding cache (solution phase only)
    if (state.currentPhase === 'solution') {
      try {
        const spec = parseGroundingSpec(artifactContent);
        const groundingResult = await runGroundingCheck(spec, 'full');
        state.groundingCheckAtSolution = {
          capturedAt: new Date().toISOString(),
          stats: groundingResult.stats,
          hasStrongWarning: groundingResult.stats.strongWarnings > 0,
        };
      } catch (err) {
        log.debug('Grounding check at solution submit skipped:', err);
      }
    }

    // Check if this is the last phase — no gate needed, complete
    if (isLastPhase(state.currentPhase)) {
      try {
        const { emitEpistemicMetricsForCycle } = await import('../../telemetry/epistemicMetrics.js');
        const snapshot = await emitEpistemicMetricsForCycle(state, getProjectPath());
        state.epistemicMetricsAtCompletion = {
          groundedRatio: snapshot.groundedRatio,
          frontierShrinkRate: snapshot.frontierShrinkRate,
          hypothesisRefutationRate: snapshot.hypothesisRefutationRate,
          capturedAt: snapshot.capturedAt,
        };
      } catch (err) {
        log.debug('Epistemic metrics emit skipped:', err);
      }

      state.lastUpdatedAt = new Date().toISOString();
      await this.saveState(state);
      
      return {
        success: true,
        completed: true,
        instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
      };
    }
    
    // v2: Set awaiting reflection instead of auto-transition
    let spawnedIds: string[] | undefined;

    if (state.currentPhase === 'discovery') {
      try {
        const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
        const memCore = await getMemoryCore();
        const fog = await memCore.getFogOfWar();
        spawnedIds = await spawnReconTasksForBlockingUnknowns(state, fog);
        if (spawnedIds.length > 0) {
          state.spawnedReconTaskIds = [...(state.spawnedReconTaskIds ?? []), ...spawnedIds];
        }
        const counts = summarizeBoundaryCounts(fog);
        state.frontierSnapshotAtDiscovery = {
          ...counts,
          capturedAt: new Date().toISOString(),
        };
      } catch (err) {
        log.debug('Discovery frontier spawn skipped:', err);
      }
    }

    state.gateInstructionId = generateGateInstructionId();
    state.gateInstructionIssuedAt = new Date().toISOString();
    state.awaitingReflection = true;
    state.lastUpdatedAt = new Date().toISOString();
    await this.saveState(state);
    
    log.debug(`Phase ${state.currentPhase} complete, awaiting reflection gate`);
    
    return {
      success: true,
      instruction: await this.finalizeInstruction(
        state,
        await this.buildGateInstruction(state, spawnedIds)
      ),
    };
  }
  
  /**
   * v2: Submit reflection gate response and transition accordingly
   */
  async submitReflection(
    taskId: string,
    reflectionContent: string
  ): Promise<CycleResponse> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    
    if (!state.awaitingReflection) {
      return { success: false, error: 'Cycle is not awaiting reflection. Submit an artifact first.' };
    }

    const gateCheck = validateGateInstructionId(state.gateInstructionId, reflectionContent);
    if (!gateCheck.valid) {
      return {
        success: false,
        error: gateCheck.error,
        instruction: await this.finalizeInstruction(state, await this.buildGateInstruction(state)),
      };
    }
    
    // Parse reflection from content
    const reflection = this.parseReflection(state.currentPhase, reflectionContent);
    state.reflections.push(reflection);
    state.awaitingReflection = false;
    state.gateInstructionId = undefined;
    state.gateInstructionIssuedAt = undefined;
    
    // Append reflection section to the phase artifact file on disk
    await this.appendReflectionToArtifact(state, reflection);
    
    // Write to REFLECTION_LOG.json
    await this.logReflection(state.taskId, reflection);
    
    log.debug(`Reflection gate: ${reflection.decision} (phase: ${state.currentPhase}, confidence: ${reflection.confidence})`);
    
    // Safeguard: store pivot/abort decisions in L2 memory
    if (reflection.decision === 'pivot' || reflection.decision === 'abort') {
      try {
        const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
        const memCore = await getMemoryCore();
        await memCore.store(
          `[${reflection.decision.toUpperCase()}] Task: ${state.taskDescription.substring(0, 100)}. Phase: ${state.currentPhase}. Reason: ${reflection.summary}`,
          {
            level: 'L2',
            source: 'runtime',
            contextKeys: [state.taskId, state.currentPhase, reflection.decision],
            confidence: 0.9,
          }
        );
        log.info(`Stored ${reflection.decision} decision in L2 memory`);
      } catch (err) {
        log.debug('Memory store on pivot/abort failed:', err);
      }
    }

    switch (reflection.decision) {
      case 'continue':
        return this.transitionToNextPhase(state);
      
      case 'pivot':
        if (reflection.taskFramingUpdate) {
          state.taskFraming = reflection.taskFramingUpdate;
          log.debug(`Task framing updated: ${state.taskFraming.substring(0, 80)}...`);
        }
        return this.transitionToNextPhase(state);
      
      case 'rewind': {
        const target = reflection.rewindTarget || this.getPreviousPhase(state.currentPhase);
        if (!target) {
          return this.transitionToNextPhase(state); // can't rewind from intake
        }
        return this.rewindToPhase(state, target);
      }
      
      case 'abort':
        state.lastUpdatedAt = new Date().toISOString();
        await this.saveState(state);
        return {
          success: true,
          completed: true,
          instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
        };
      
      default:
        // Unknown decision — treat as continue
        return this.transitionToNextPhase(state);
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
      return {
        success: true,
        instruction: await this.finalizeInstruction(state, await this.buildGateInstruction(state)),
      };
    }
    
    return {
      success: true,
      instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
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
  private async transitionToNextPhase(state: CycleState): Promise<CycleResponse> {
    const nextPhase = getNextPhase(state.currentPhase);
    
    if (!nextPhase) {
      state.lastUpdatedAt = new Date().toISOString();
      await this.saveState(state);
      return {
        success: true,
        completed: true,
        instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
      };
    }
    
    state.currentPhase = nextPhase;
    resetPhaseMcpTracking(state);
    state.phaseEnteredAt = new Date().toISOString();
    state.lastUpdatedAt = new Date().toISOString();
    await this.saveState(state);
    
    log.debug(`Transitioned to phase: ${nextPhase}`);
    
    return {
      success: true,
      instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
    };
  }
  
  /**
   * Rewind to an earlier phase. Removes later phases from completedPhases.
   * Max 2 rewinds per phase to prevent infinite loops.
   */
  private async rewindToPhase(state: CycleState, target: PhaseType): Promise<CycleResponse> {
    const targetOrder = PHASE_CONFIGS[target].order;
    
    // Guard: can't rewind forward
    if (targetOrder >= PHASE_CONFIGS[state.currentPhase].order) {
      return this.transitionToNextPhase(state);
    }
    
    // Guard: max rewinds
    state.phaseAttempts[target] = (state.phaseAttempts[target] || 0) + 1;
    if (state.phaseAttempts[target] > 2) {
      log.warn(`Max rewinds reached for ${target}, forcing continue`);
      return this.transitionToNextPhase(state);
    }
    
    // Remove all phases after target from completedPhases
    state.completedPhases = state.completedPhases.filter(p => {
      return PHASE_CONFIGS[p].order < targetOrder;
    });
    
    state.currentPhase = target;
    resetPhaseMcpTracking(state);
    state.phaseEnteredAt = new Date().toISOString();
    state.lastUpdatedAt = new Date().toISOString();
    await this.saveState(state);
    
    log.debug(`Rewound to phase: ${target}`);
    
    return {
      success: true,
      instruction: await this.finalizeInstruction(state, this.generateInstruction(state)),
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
        template: gateTemplate
      },
      instruction: `📄 **Артефакт сохранён:** \`${artifactsDir}/${filename}\`
${this.extractBriefSummary(state.artifacts[state.currentPhase])}

Фаза ${state.currentPhase.toUpperCase()} завершена. Пройдите Reflection Gate (${weight}).

${this.buildCarryForward(state)}
${gateTemplate}

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
   * Parse reflection JSON from content. Falls back to auto-CONTINUE on parse failure.
   */
  private parseReflection(phase: PhaseType, content: string): ReflectionGate {
    const defaultReflection: ReflectionGate = {
      phase,
      decision: 'continue',
      changeDetected: false,
      summary: 'Auto-continue (no reflection provided)',
      confidence: 1.0,
      timestamp: new Date().toISOString()
    };
    
    try {
      // Try to extract JSON from content (may be wrapped in markdown code block)
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      
      const parsed = JSON.parse(jsonStr);
      
      const decision = this.validateDecision(parsed.decision);
      
      return {
        phase,
        decision,
        changeDetected: Boolean(parsed.change_detected),
        summary: String(parsed.summary || ''),
        taskFramingUpdate: parsed.task_framing_update ? String(parsed.task_framing_update) : undefined,
        rewindTarget: parsed.rewind_target ? this.validatePhase(parsed.rewind_target) : undefined,
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      log.warn(`Failed to parse reflection, auto-continuing: ${err}`);
      return defaultReflection;
    }
  }
  
  private validateDecision(raw: unknown): ReflectionDecision {
    const valid: ReflectionDecision[] = ['continue', 'pivot', 'rewind', 'abort'];
    const str = String(raw).toLowerCase().trim();
    return valid.includes(str as ReflectionDecision) ? (str as ReflectionDecision) : 'continue';
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
    const artifactsDir = path.join(getProjectPath(), CYCLES_DIR, state.taskSlug);
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
  private async logReflection(taskId: string, reflection: ReflectionGate): Promise<void> {
    const logDir = path.join(getProjectPath(), '.m7', 'cycles');
    const logPath = path.join(logDir, `${taskId}_REFLECTION_LOG.jsonl`);
    
    const entry = JSON.stringify({
      taskId,
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
    return state;
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
   * Build carry-forward context from completed phases and their reflections.
   * Gives AI context about what happened so far, even in a new chat session.
   */
  private buildCarryForward(state: CycleState): string {
    if (state.completedPhases.length === 0) return '';
    
    const artifactsDir = `${CYCLES_DIR}/${state.taskSlug}`;
    const rows: string[] = [];
    for (const phase of state.completedPhases) {
      const reflection = state.reflections.find(r => r.phase === phase);
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
  ): Promise<CycleInstruction> {
    const track = trackPhaseMcpCall(state);
    state.lastUpdatedAt = new Date().toISOString();
    await this.saveState(state);

    if (track.shouldReinject) {
      const block = buildRuleReinjectionBlock(state, getPhaseConfig(state.currentPhase));
      instruction.instruction = appendRuleReinjection(instruction.instruction, block);
    }

    return instruction;
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
  
  private generateTaskId(description: string): string {
    const slug = description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 20);
    const shortId = Date.now().toString().slice(-6);
    return `cycle_${slug}_${shortId}`;
  }
  
  private generateSlug(description: string): string {
    // Handle Cyrillic and Latin characters
    return description
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/gi, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);
  }
  
  private async getState(taskId: string): Promise<CycleState | null> {
    // Try memory first
    if (this.cycles.has(taskId)) {
      return this.migrateState(this.cycles.get(taskId)!);
    }
    
    // Try disk
    const statePath = path.join(this.cyclesDir, `${taskId}.json`);
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      const state = this.migrateState(JSON.parse(content) as CycleState);
      this.cycles.set(taskId, state);
      return state;
    } catch {
      return null;
    }
  }
  
  private async saveState(state: CycleState): Promise<void> {
    try {
      await fs.mkdir(this.cyclesDir, { recursive: true });
      const statePath = path.join(this.cyclesDir, `${state.taskId}.json`);
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
      this.cycles.set(state.taskId, state);
    } catch (err) {
      log.warn(`Failed to save cycle state: ${err}`);
    }
  }

  /**
   * Register a 4-5 word summary for a completed cycle and append to CYCLE_REGISTRY.md
   */
  async registerSummary(taskId: string, summary: string): Promise<{ success: boolean; entry?: string; error?: string }> {
    const state = await this.getState(taskId);
    if (!state) {
      return { success: false, error: `Cycle ${taskId} not found` };
    }
    
    const projectPath = getProjectPath();
    const registryPath = path.join(projectPath, 'CYCLE_REGISTRY.md');
    
    const type = state.taskSlug.startsWith('feat') ? 'feat' : 'cycle';
    const folder = `${CYCLES_DIR}/${state.taskSlug}`;
    const phases = `${state.completedPhases.length}/7`;
    const date = new Date().toISOString().slice(5, 10); // MM-DD
    
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
    
    const entry = `| ${nextNum} | ${date} | ${type} | ${phases} | ${summary} | ${folder} |`;
    
    // Append entry before the ADR section (or at end if no ADR)
    const adrIndex = registryContent.indexOf('\n## ADR');
    if (adrIndex > -1) {
      registryContent = registryContent.slice(0, adrIndex) + entry + '\n' + registryContent.slice(adrIndex);
    } else {
      registryContent = registryContent.trimEnd() + '\n' + entry + '\n';
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
