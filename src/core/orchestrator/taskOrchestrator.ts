import { createLogger } from '../utils/logger.js';
const log = createLogger('[taskOrchestrator]');
import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCrossSessionLearning, CrossSessionLearning } from '../../cross-session/index.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v3.10.5: Session persistence via atomic write
import { atomicWriteJSON, safeReadJSON } from '../utils/atomicWrite.js';
import { getProjectPath } from '../utils/projectPath.js';

export interface TaskSession {
  id: string;
  taskDescription: string;
  route: 'light' | 'medium' | 'heavy';
  currentPhase: 'discovery' | 'architecture' | 'planning' | 'implementation' | 'validation' | 'completed';
  phaseRequirements: Record<string, boolean>;
  blockedReasons: string[];
  startTime: Date;
  phaseTimestamps: Record<string, Date>;
  canProceedToCode: boolean;
  violations: Array<{
    phase: string;
    reason: string;
    timestamp: Date;
  }>;
  /** Set when completeSession (or guard) refuses; cleared on successful completion. */
  lastError?: string;
  /** Present when the session was closed with force: true. */
  forcedCompletion?: { at: string; notes?: string };
}

export interface CompleteSessionOptions {
  force?: boolean;
}

/**
 * Serialized form of TaskSession for JSON persistence (v3.10.5)
 */
interface SerializedSession {
  id: string;
  taskDescription: string;
  route: 'light' | 'medium' | 'heavy';
  currentPhase: TaskSession['currentPhase'];
  phaseRequirements: Record<string, boolean>;
  blockedReasons: string[];
  startTime: string; // ISO string
  phaseTimestamps: Record<string, string>; // ISO strings
  canProceedToCode: boolean;
  violations: Array<{
    phase: string;
    reason: string;
    timestamp: string; // ISO string
  }>;
  lastError?: string;
  forcedCompletion?: { at: string; notes?: string };
}

export interface M7Agent {
  name: string;
  role: 'researcher' | 'architect' | 'executor' | 'supervisor';
  status: 'idle' | 'working' | 'blocked' | 'completed';
  currentTask?: string;
  requirements: string[];
  outputs: any[];
}

export class TaskOrchestrator {
  private activeSessions: Map<string, TaskSession> = new Map();
  private agents: Map<string, M7Agent> = new Map();
  private enforcementMode: 'strict' | 'advisory' | 'disabled' = 'strict';
  private lastStatusCheck: Map<string, Date> = new Map(); // NEW: prevent status check loops
  private userInteractionHistory: Array<{action: string, sessionId: string, timestamp: Date}> = []; // NEW: track interaction patterns
  private crossSessionLearning: CrossSessionLearning; // v3.9: Cross-Session Learning integration
  private memoryCore: UnifiedMemoryCore | null = null; // v5.0: Unified memory
  private sessionsLoaded: boolean = false; // v3.10.5: Track if sessions loaded from disk
  private persistDebounce: ReturnType<typeof setTimeout> | null = null; // v3.10.5: Debounce persistence

  constructor(
    private journal: JournalSystem
  ) {
    this.crossSessionLearning = getCrossSessionLearning();
    this.initializeAgents();
    // v3.10.5: Load persisted sessions on construction
    this.loadSessions().catch(err => {
      log.warn(`[v3.10.5] Failed to load persisted sessions: ${err.message}`);
    });
  }

  // ============================================================================
  // v3.10.5: Session Persistence
  // ============================================================================

  private getSessionsFilePath(): string {
    const projectPath = getProjectPath();
    return path.join(projectPath, '.m7', 'orchestrator-sessions.json');
  }

  /**
   * Load sessions from disk (.m7/orchestrator-sessions.json)
   * Called once on construction and before any session lookup.
   */
  private async loadSessions(): Promise<void> {
    if (this.sessionsLoaded) return;
    
    try {
      const filePath = this.getSessionsFilePath();
      const result = await safeReadJSON<Record<string, SerializedSession>>(filePath);
      
      if (result.data && typeof result.data === 'object') {
        let loaded = 0;
        const now = Date.now();
        const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        for (const [id, serialized] of Object.entries(result.data)) {
          try {
            // Skip very old sessions
            const startTime = new Date(serialized.startTime);
            if (now - startTime.getTime() > MAX_SESSION_AGE_MS) continue;
            // Skip already completed sessions older than 1 day
            if (serialized.currentPhase === 'completed') {
              const completedAt = serialized.phaseTimestamps?.completed;
              if (completedAt && now - new Date(completedAt).getTime() > 24 * 60 * 60 * 1000) continue;
            }
            
            const session = this.deserializeSession(serialized);
            // Don't overwrite sessions that are already in memory
            if (!this.activeSessions.has(id)) {
              this.activeSessions.set(id, session);
              loaded++;
            }
          } catch (err: any) {
            log.warn(`[v3.10.5] Skipping corrupt session ${id}: ${err.message}`);
          }
        }
        
        if (loaded > 0) {
          log.info(`[v3.10.5] Loaded ${loaded} session(s) from disk`);
        }
      }
    } catch {
      // No sessions file — that's OK for first run
    }
    
    this.sessionsLoaded = true;
  }

  /**
   * Persist all active sessions to disk.
   * Debounced to avoid excessive writes during rapid updates.
   */
  private schedulePersist(): void {
    if (this.persistDebounce) {
      clearTimeout(this.persistDebounce);
    }
    this.persistDebounce = setTimeout(() => {
      this.persistSessions().catch(err => {
        log.warn(`[v3.10.5] Failed to persist sessions: ${err.message}`);
      });
    }, 500); // 500ms debounce
  }

  private async persistSessions(): Promise<void> {
    const filePath = this.getSessionsFilePath();
    const data: Record<string, SerializedSession> = {};
    
    for (const [id, session] of this.activeSessions) {
      data[id] = this.serializeSession(session);
    }
    
    try {
      // Ensure .m7/ directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteJSON(filePath, data);
      log.debug(`[v3.10.5] Persisted ${Object.keys(data).length} session(s)`);
    } catch (err: any) {
      log.warn(`[v3.10.5] Session persistence failed: ${err.message}`);
    }
  }

  private serializeSession(session: TaskSession): SerializedSession {
    return {
      id: session.id,
      taskDescription: session.taskDescription,
      route: session.route,
      currentPhase: session.currentPhase,
      phaseRequirements: { ...session.phaseRequirements },
      blockedReasons: [...session.blockedReasons],
      startTime: session.startTime.toISOString(),
      phaseTimestamps: Object.fromEntries(
        Object.entries(session.phaseTimestamps).map(([k, v]) => [k, v.toISOString()])
      ),
      canProceedToCode: session.canProceedToCode,
      violations: session.violations.map(v => ({
        phase: v.phase,
        reason: v.reason,
        timestamp: v.timestamp.toISOString()
      })),
      lastError: session.lastError,
      forcedCompletion: session.forcedCompletion,
    };
  }

  private deserializeSession(data: SerializedSession): TaskSession {
    return {
      id: data.id,
      taskDescription: data.taskDescription,
      route: data.route,
      currentPhase: data.currentPhase,
      phaseRequirements: { ...data.phaseRequirements },
      blockedReasons: data.blockedReasons || [],
      startTime: new Date(data.startTime),
      phaseTimestamps: Object.fromEntries(
        Object.entries(data.phaseTimestamps || {}).map(([k, v]) => [k, new Date(v)])
      ),
      canProceedToCode: data.canProceedToCode || false,
      violations: (data.violations || []).map(v => ({
        phase: v.phase,
        reason: v.reason,
        timestamp: new Date(v.timestamp)
      })),
      lastError: data.lastError,
      forcedCompletion: data.forcedCompletion,
    };
  }

  /**
   * Ensure sessions are loaded before any lookup.
   * Call this at the start of any public method that reads sessions.
   */
  private async ensureSessionsLoaded(): Promise<void> {
    if (!this.sessionsLoaded) {
      await this.loadSessions();
    }
  }

  // Генерация семантического ID для сессии
  private generateSemanticSessionId(taskDescription: string): string {
    const slug = taskDescription
      .toLowerCase()
      .trim()
      .replace(/[^\u0040-\u1FFF\u2C00-\uD7FF\w\s-]/g, '') // Keep Latin, Cyrillic, spaces, hyphens
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/--+/g, '-')     // Replace multiple hyphens with single
      .slice(0, 30)             // Limit length
      .replace(/^-+|-+$/g, ''); // Trim leading/trailing hyphens
    
    // Добавляем короткий уникальный суффикс
    const shortId = Date.now().toString().slice(-4);
    return `task_${slug}_${shortId}`;
  }

  private initializeAgents() {
    // Researcher Agent - глубокий анализ
    this.agents.set('researcher', {
      name: 'M7 Researcher',
      role: 'researcher',
      status: 'idle',
      requirements: [
        'Context7 library verification completed',
        'Minimum 3 alternative solutions researched', 
        'Best practices documented',
        'Performance benchmarks identified',
        'Edge cases mapped'
      ],
      outputs: []
    });

    // Architect Agent - системный анализ
    this.agents.set('architect', {
      name: 'M7 Architect', 
      role: 'architect',
      status: 'idle',
      requirements: [
        'Current system components mapped',
        'Dependencies identified and verified',
        'Integration points documented',
        'Performance impact assessed',
        'Backward compatibility checked'
      ],
      outputs: []
    });

    // Executor Agent - контролируемая реализация
    this.agents.set('executor', {
      name: 'M7 Executor',
      role: 'executor', 
      status: 'idle',
      requirements: [
        'Implementation plan approved by architect',
        'All critical risks mitigated',
        'Tests written before code',
        'Playwright validation scenarios prepared',
        'Rollback plan documented'
      ],
      outputs: []
    });

    // Supervisor Agent - контроль качества
    this.agents.set('supervisor', {
      name: 'M7 Supervisor',
      role: 'supervisor',
      status: 'idle', 
      requirements: [
        'All phase requirements validated',
        'Code quality gates passed',
        'Performance benchmarks met',
        'Documentation updated',
        'Success metrics measured'
      ],
      outputs: []
    });
  }

  async startTask(taskDescription: string, route: 'light' | 'medium' | 'heavy'): Promise<TaskSession> {
    await this.ensureSessionsLoaded(); // v3.10.5
    
    // Используем семантические названия вместо timestamp
    const sessionId = this.generateSemanticSessionId(taskDescription);
    
    const session: TaskSession = {
      id: sessionId,
      taskDescription,
      route,
      currentPhase: 'discovery',
      phaseRequirements: this.initializePhaseRequirements(route),
      blockedReasons: [],
      startTime: new Date(),
      phaseTimestamps: { discovery: new Date() },
      canProceedToCode: false,
      violations: []
    };

    this.activeSessions.set(sessionId, session);
    this.schedulePersist(); // v3.10.5: Save to disk
    
    // v3.9: Start cross-session tracking
    try {
      await this.crossSessionLearning.initialize();
      this.crossSessionLearning.startSession(sessionId);
      log.debug(`M7 v3.9] ▶ Cross-Session tracking started for: ${sessionId}`);
    } catch (e: any) {
      log.warn(`M7 v3.9] Cross-Session tracking failed to start: ${e.message}`);
    }
    
    // Логируем начало сессии
    await this.journal.logFeature({
      name: `M7 Task Session Started`,
      description: `Orchestrated task: ${taskDescription}`,
      implementation: `Route: ${route}, Phase: discovery`,
      lessons: ['Task orchestration initiated'],
      patterns: ['M7 orchestration', 'Phase enforcement'],
      complexity: route
    });

    return session;
  }

  private initializePhaseRequirements(route: 'light' | 'medium' | 'heavy'): Record<string, boolean> {
    const baseRequirements: Record<string, boolean> = {
      // Discovery Phase
      'existing_system_analysis': false, // NEW: Critical requirement
      'context7_verification': false,
      'alternatives_researched': false,
      'best_practices_documented': false,
      'edge_cases_identified': false,
      
      // Architecture Phase  
      'components_mapped': false,
      'dependencies_verified': false,
      'integration_points_documented': false,
      'performance_impact_assessed': false,
      
      // Planning Phase
      'user_validation': false, // NEW: Critical for medium/heavy
      'implementation_plan_created': false,
      'critical_risks_mitigated': false,
      'tests_planned': false,
      'rollback_plan_documented': false,
      
      // Implementation Phase
      'code_quality_verified': false,
      'tests_passing': false,
      'performance_benchmarks_met': false,
      
      // Validation Phase
      'playwright_validation_passed': false,
      'success_metrics_measured': false,
      'documentation_updated': false
    };

    // Remove user_validation for light tasks
    if (route === 'light') {
      delete baseRequirements['user_validation'];
    }

    if (route === 'medium') {
      baseRequirements['prototype_created'] = false;
      baseRequirements['integration_tested'] = false;
    }

    if (route === 'heavy') {
      baseRequirements['prototype_created'] = false;
      baseRequirements['integration_tested'] = false;
      baseRequirements['load_testing_completed'] = false;
      baseRequirements['security_review_passed'] = false;
      baseRequirements['deployment_plan_verified'] = false;
    }

    return baseRequirements;
  }

  async checkCanProceedToCode(sessionId: string): Promise<{
    canProceed: boolean;
    blockers: string[];
    completedRequirements: string[];
    nextActions: string[];
  }> {
    await this.ensureSessionsLoaded(); // v3.10.5
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const blockers: string[] = [];
    const completedRequirements: string[] = [];
    const nextActions: string[] = [];

    // Проверяем обязательные требования для перехода к коду
    const criticalPhases = ['discovery', 'architecture', 'planning'];
    
    for (const phase of criticalPhases) {
      if (session.currentPhase === phase || this.isPhaseCompleted(session, phase)) {
        const phaseBlockers = this.checkPhaseCompletion(session, phase);
        blockers.push(...phaseBlockers);
      }
    }

    // Собираем выполненные требования
    Object.entries(session.phaseRequirements).forEach(([req, completed]) => {
      if (completed) {
        completedRequirements.push(req);
      }
    });

    // Генерируем следующие действия
    if (blockers.length > 0) {
      nextActions.push(...this.generateNextActions(session));
    }

    const canProceed = blockers.length === 0 && 
                      this.isPhaseCompleted(session, 'discovery') &&
                      this.isPhaseCompleted(session, 'architecture') &&
                      this.isPhaseCompleted(session, 'planning');

    session.canProceedToCode = canProceed;
    session.blockedReasons = blockers;

    return {
      canProceed,
      blockers,
      completedRequirements,
      nextActions
    };
  }

  private checkPhaseCompletion(session: TaskSession, phase: string): string[] {
    const blockers: string[] = [];
    
    switch (phase) {
      case 'discovery':
        if (!session.phaseRequirements['existing_system_analysis']) {
          blockers.push('Existing system analysis not completed');
        }
        if (!session.phaseRequirements['context7_verification']) {
          blockers.push('Context7 library verification not completed');
        }
        if (!session.phaseRequirements['alternatives_researched']) {
          blockers.push('Alternative solutions not researched (minimum 3 required)');
        }
        if (!session.phaseRequirements['best_practices_documented']) {
          blockers.push('Best practices not documented');
        }
        break;

      case 'architecture':
        if (!session.phaseRequirements['components_mapped']) {
          blockers.push('System components not mapped');
        }
        if (!session.phaseRequirements['dependencies_verified']) {
          blockers.push('Dependencies not verified');
        }
        if (!session.phaseRequirements['performance_impact_assessed']) {
          blockers.push('Performance impact not assessed');
        }
        break;

      case 'planning':
        if (!session.phaseRequirements['user_validation']) {
          blockers.push('User validation not completed for medium/heavy tasks');
        }
        if (!session.phaseRequirements['implementation_plan_created']) {
          blockers.push('Implementation plan not created');
        }
        if (!session.phaseRequirements['critical_risks_mitigated']) {
          blockers.push('Critical risks not mitigated');
        }
        if (!session.phaseRequirements['tests_planned']) {
          blockers.push('Test plan not created');
        }
        break;
    }

    return blockers;
  }

  private isPhaseCompleted(session: TaskSession, phase: string): boolean {
    const phaseRequirements = this.getPhaseRequirements(session, phase);
    if (phaseRequirements.length === 0) {
      return false;
    }
    return phaseRequirements.every(req => session.phaseRequirements[req]);
  }

  private getPhaseRequirements(session: TaskSession, phase: string): string[] {
    let base: string[];
    switch (phase) {
      case 'discovery':
        base = [
          'existing_system_analysis',
          'context7_verification',
          'alternatives_researched',
          'best_practices_documented',
          'edge_cases_identified',
        ];
        break;
      case 'architecture':
        base = [
          'components_mapped',
          'dependencies_verified',
          'integration_points_documented',
          'performance_impact_assessed',
        ];
        break;
      case 'planning':
        base = [
          'user_validation',
          'implementation_plan_created',
          'critical_risks_mitigated',
          'tests_planned',
          'rollback_plan_documented',
        ];
        break;
      case 'implementation':
        base = ['code_quality_verified', 'tests_passing', 'performance_benchmarks_met'];
        break;
      case 'validation':
        base = [
          'playwright_validation_passed',
          'success_metrics_measured',
          'documentation_updated',
        ];
        break;
      default:
        return [];
    }
    return base.filter(key => key in session.phaseRequirements);
  }

  private generateNextActions(session: TaskSession): string[] {
    const actions: string[] = [];
    
    Object.entries(session.phaseRequirements).forEach(([req, completed]) => {
      if (!completed) {
        switch (req) {
          case 'existing_system_analysis':
            actions.push('Analyze the current system to understand its structure and dependencies');
            break;
          case 'context7_verification':
            actions.push('Use @context7 to verify all library dependencies and compatibility');
            break;
          case 'alternatives_researched':
            actions.push('Research and document minimum 3 alternative implementation approaches');
            break;
          case 'components_mapped':
            actions.push('Map all system components that will be affected by this change');
            break;
          case 'critical_risks_mitigated':
            actions.push('Identify and create mitigation plans for all critical risks');
            break;
          case 'user_validation':
            actions.push('Conduct user validation to ensure the solution meets real-world needs');
            break;
        }
      }
    });

    return actions.slice(0, 5); // Limit to top 5 actions
  }

  async markRequirementComplete(sessionId: string, requirement: string, evidence?: any): Promise<void> {
    await this.ensureSessionsLoaded(); // v3.10.5
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.phaseRequirements[requirement] = true;
    this.schedulePersist(); // v3.10.5: Save updated state
    
    // v5.0: Store evidence in unified memory
    if (evidence) {
      try {
        if (!this.memoryCore) {
          this.memoryCore = await getMemoryCore();
        }
        await this.memoryCore.store(
          JSON.stringify({
            requirement,
            evidence,
            completedAt: new Date().toISOString(),
            sessionId
          }),
          {
            level: 'L1',
            source: 'runtime',
            contextKeys: ['session', sessionId, 'requirement', requirement],
            confidence: 0.9
          }
        );
      } catch (error: any) {
        log.warn(`[TaskOrchestrator] Failed to store evidence: ${error.message}`);
      }
    }

    // Check if phase is now complete
    this.checkPhaseTransition(session);
  }

  private checkPhaseTransition(session: TaskSession): void {
    const currentPhaseReqs = this.getPhaseRequirements(session, session.currentPhase);
    if (currentPhaseReqs.length === 0) {
      return;
    }
    const isCurrentPhaseComplete = currentPhaseReqs.every(req => session.phaseRequirements[req]);

    if (isCurrentPhaseComplete) {
      const nextPhase = this.getNextPhase(session.currentPhase);
      if (nextPhase && nextPhase !== 'completed') {
        session.currentPhase = nextPhase;
        session.phaseTimestamps[nextPhase] = new Date();
        this.schedulePersist();
      }
    }
  }

  private getNextPhase(currentPhase: string): TaskSession['currentPhase'] | null {
    const phaseOrder: TaskSession['currentPhase'][] = ['discovery', 'architecture', 'planning', 'implementation', 'validation', 'completed'];
    const currentIndex = phaseOrder.indexOf(currentPhase as TaskSession['currentPhase']);
    return currentIndex < phaseOrder.length - 1 ? phaseOrder[currentIndex + 1] : null;
  }

  async enforceM7Compliance(action: 'code_change' | 'file_edit' | 'implementation', sessionId?: string): Promise<{
    allowed: boolean;
    reason: string;
    requiredActions: string[];
  }> {
    await this.ensureSessionsLoaded(); // v3.10.5
    if (this.enforcementMode === 'disabled') {
      return { allowed: true, reason: 'Enforcement disabled', requiredActions: [] };
    }

    if (!sessionId) {
      return {
        allowed: false,
        reason: 'No active M7 session. Start with @m7 analyze task first.',
        requiredActions: ['Run @m7 analyze task "description"']
      };
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        allowed: false,
        reason: 'Invalid session. Start new task analysis.',
        requiredActions: ['Run @m7 analyze task "description"']
      };
    }

    const complianceCheck = await this.checkCanProceedToCode(sessionId);
    
    if (!complianceCheck.canProceed) {
      session.violations.push({
        phase: session.currentPhase,
        reason: `Attempted ${action} without completing M7 requirements`,
        timestamp: new Date()
      });

      return {
        allowed: this.enforcementMode !== 'strict',
        reason: `M7 Methodology violation: ${complianceCheck.blockers.join(', ')}`,
        requiredActions: complianceCheck.nextActions
      };
    }

    return { allowed: true, reason: 'M7 compliance verified', requiredActions: [] };
  }

  getSessionStatus(sessionId: string): TaskSession | null {
    // v3.10.5: Sync check — sessions should already be loaded from constructor
    // If not loaded yet (race condition), return null and let caller retry
    return this.activeSessions.get(sessionId) || null;
  }

  getAllActiveSessions(): TaskSession[] {
    return Array.from(this.activeSessions.values());
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeSessions: number;
    blockedSessions: number;
    violations: number;
    agents: Record<string, string>;
  }> {
    const sessions = this.getAllActiveSessions();
    const blockedSessions = sessions.filter(s => s.blockedReasons.length > 0);
    const totalViolations = sessions.reduce((sum, s) => sum + s.violations.length, 0);

    const agentStatuses: Record<string, string> = {};
    this.agents.forEach((agent, name) => {
      agentStatuses[name] = agent.status;
    });

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (blockedSessions.length > sessions.length * 0.5) {
      status = 'unhealthy';
    } else if (blockedSessions.length > 0 || totalViolations > 5) {
      status = 'degraded';
    }

    return {
      status,
      activeSessions: sessions.length,
      blockedSessions: blockedSessions.length,
      violations: totalViolations,
      agents: agentStatuses
    };
  }

  // NEW: Anti-loop logic
  canCheckStatus(sessionId: string): {allowed: boolean, reason?: string, suggestedAction?: string} {
    const lastCheck = this.lastStatusCheck.get(sessionId);
    const now = new Date();
    
    // Prevent status checks within 30 seconds
    if (lastCheck && (now.getTime() - lastCheck.getTime()) < 30000) {
      return {
        allowed: false,
        reason: 'Status check too frequent (within 30 seconds)',
        suggestedAction: 'Focus on completing specific requirements instead of checking status'
      };
    }

    // Check interaction history for loop patterns
    const recentActions = this.userInteractionHistory.filter(h => 
      h.sessionId === sessionId && 
      (now.getTime() - h.timestamp.getTime()) < 120000 // Last 2 minutes
    );

    const statusChecks = recentActions.filter(a => a.action === 'status_check').length;
    
    if (statusChecks >= 3) {
      return {
        allowed: false,
        reason: 'Too many status checks detected (3+ in 2 minutes)',
        suggestedAction: 'Use @m7 mark complete to progress instead of checking status repeatedly'
      };
    }

    return { allowed: true };
  }

  recordInteraction(action: string, sessionId: string) {
    this.userInteractionHistory.push({
      action,
      sessionId,
      timestamp: new Date()
    });

    // Keep only last 50 interactions
    if (this.userInteractionHistory.length > 50) {
      this.userInteractionHistory = this.userInteractionHistory.slice(-50);
    }

    if (action === 'status_check') {
      this.lastStatusCheck.set(sessionId, new Date());
    }
  }

  // NEW: Get suggestions to break loops
  getLoopBreakingSuggestions(sessionId: string): string[] {
    const session = this.getSessionStatus(sessionId);
    if (!session) return [];

    const suggestions: string[] = [];
    
    const incompleteReqs = Object.entries(session.phaseRequirements)
      .filter(([_, completed]) => !completed)
      .slice(0, 2);

    if (incompleteReqs.length > 0) {
      incompleteReqs.forEach(([req, _]) => {
        switch (req) {
          case 'existing_system_analysis':
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="existing_system_analysis" evidence="Analyzed current system"`);
            break;
          case 'context7_verification':
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="context7_verification" evidence="Verified dependencies"`);
            break;
          case 'alternatives_researched':
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="alternatives_researched" evidence="Researched 3 approaches"`);
            break;
          case 'best_practices_documented':
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="best_practices_documented" evidence="Documented patterns"`);
            break;
          case 'user_validation':
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="user_validation" evidence="Conducted user validation"`);
            break;
          default:
            suggestions.push(`✅ Complete: @m7 mark complete session_id="${sessionId}" requirement="${req}" evidence="Completed research"`);
            break;
        }
      });
    }

    return suggestions;
  }

  // NEW: Smart session completion
  canCompleteSession(sessionId: string): {canComplete: boolean, reason: string} {
    const session = this.getSessionStatus(sessionId);
    if (!session) {
      return {canComplete: false, reason: 'Session not found'};
    }

    if (session.canProceedToCode) {
      return {canComplete: true, reason: 'All requirements satisfied - ready for completion'};
    }

    const completedCount = Object.values(session.phaseRequirements).filter(Boolean).length;
    const totalCount = Object.keys(session.phaseRequirements).length;
    const completionPercent = (completedCount / totalCount) * 100;

    if (completionPercent >= 80) {
      return {canComplete: true, reason: `${completionPercent.toFixed(0)}% complete - sufficient for manual completion`};
    }

    return {canComplete: false, reason: `Only ${completionPercent.toFixed(0)}% complete - more work needed`};
  }

  async completeSession(
    sessionId: string,
    completionNotes?: string,
    options?: CompleteSessionOptions
  ): Promise<boolean> {
    await this.ensureSessionsLoaded(); // v3.10.5
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.currentPhase === 'completed') {
      session.lastError = 'Session is already completed.';
      this.schedulePersist();
      return false;
    }

    const force = options?.force === true;
    if (!force) {
      if (session.currentPhase !== 'validation') {
        session.lastError =
          `Cannot complete session from phase "${session.currentPhase}". ` +
          'Reach the validation phase with all validation requirements marked complete, or pass force: true.';
        this.schedulePersist();
        return false;
      }
      if (!this.isPhaseCompleted(session, 'validation')) {
        const pending = this.getPhaseRequirements(session, 'validation').filter(
          req => !session.phaseRequirements[req]
        );
        session.lastError =
          `Validation requirements incomplete: ${pending.join(', ') || 'unknown'}. ` +
          'Use mark_complete for each requirement, or pass force: true.';
        this.schedulePersist();
        return false;
      }
    } else {
      session.forcedCompletion = {
        at: new Date().toISOString(),
        notes: completionNotes,
      };
    }

    session.lastError = undefined;
    await this.finalizeCompletedSession(session, completionNotes);
    return true;
  }

  private async finalizeCompletedSession(session: TaskSession, completionNotes?: string): Promise<void> {
    session.currentPhase = 'completed';
    session.phaseTimestamps.completed = new Date();

    // v3.9: End cross-session tracking and extract insights
    try {
      const { newInsights, qualityScore } = await this.crossSessionLearning.endSession(session);
      log.debug(`M7 v3.9] ■ Cross-Session tracking ended: ${newInsights.length} insights extracted (quality: ${qualityScore.toFixed(0)}/100)`);

      if (newInsights.length > 0) {
        log.debug(`M7 v3.9] 💡 New insights:`);
        newInsights.slice(0, 3).forEach(insight => {
          log.debug(`   - [${insight.type}] ${insight.content.substring(0, 60)}...`);
        });
      }
    } catch (e: any) {
      log.warn(`M7 v3.9] Cross-Session tracking failed to end: ${e.message}`);
    }

    await this.journal.logFeature({
      name: `M7 Session Completed`,
      description: `Task: ${session.taskDescription}`,
      implementation: `Route: ${session.route}, Duration: ${Date.now() - session.startTime.getTime()}ms`,
      lessons: [completionNotes || 'Session completed successfully'],
      patterns: ['M7 completion', 'Session lifecycle'],
      complexity: session.route
    });

    this.schedulePersist(); // v3.10.5: Save completed state
  }
} 