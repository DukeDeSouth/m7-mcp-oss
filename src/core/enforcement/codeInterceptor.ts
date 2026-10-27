import { createLogger } from '../utils/logger.js';
const log = createLogger('[codeInterceptor]');
import { TaskOrchestrator } from '../orchestrator/taskOrchestrator.js';
import { ScopeGuard, FileChange } from '../guards/scopeGuard.js';
import { CodeModRequest } from '../types.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';

export interface InterceptorResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
  suggestion?: string;
  sessionId?: string;
  memoryInsights?: string[];
  requiredActions?: string[];
  context?: {
    session: string;
    phase: string;
    memory: string[];
    scopeStatus?: {
      level: 'green' | 'yellow' | 'orange' | 'red';
      message: string;
      visualization?: string;
    };
  };
}

export type EnforcementLevel = 'strict' | 'moderate' | 'off';

export class M7CodeInterceptor {
  private enforcementLevel: EnforcementLevel = 'strict';
  private stats = {
    totalInterceptions: 0,
    allowed: 0,
    blocked: 0
  };
  private memoryCore: UnifiedMemoryCore | null = null;

  constructor(
    private orchestrator: TaskOrchestrator,
    private scopeGuard: ScopeGuard // v5.0: Memory removed from constructor
  ) {}

  /**
   * CRITICAL: Intercepts all code modification attempts
   * Must be called before ANY file editing
   */
  async interceptCodeModification(request: CodeModRequest): Promise<InterceptorResult> {
    this.stats.totalInterceptions++;

    // Find active M7 session
    const sessions = this.orchestrator.getAllActiveSessions();
    const session = sessions.find(s => 
      s.currentPhase !== 'completed' && s.currentPhase !== 'validation'
    );

    if (!session && this.enforcementLevel === 'strict') {
      this.stats.blocked++;
      return {
        allowed: false,
        reason: 'No active M7 session. Start with: @m7 analyze task "description"',
        suggestion: 'Use @m7 analyze task to properly plan and execute changes'
      };
    }

    if (!session) {
      // Moderate or off mode - allow but warn
      return {
        allowed: true,
        warning: 'Working without M7 methodology guidance'
      };
    }

    // Check if coding is allowed in current phase
    const canProceed = await this.orchestrator.checkCanProceedToCode(session.id);
    if (!canProceed.canProceed && this.enforcementLevel === 'strict') {
      this.stats.blocked++;
      return {
        allowed: false,
        reason: 'M7 requirements not met',
        requiredActions: canProceed.blockers || []
      };
    }

    // NEW: Scope check
    if (session?.id) {
      const scopeStatus = this.scopeGuard.trackChange(session.id, {
        file: request.file,
        linesAdded: request.linesAdded || 0,
        linesRemoved: request.linesRemoved || 0,
        type: request.type || 'modify'
      });

      if (scopeStatus.level === 'red') {
        return {
          allowed: false,
          reason: '🚨 SCOPE LIMIT EXCEEDED',
          suggestion: 'Commit current changes and create new task for additional work',
          context: {
            session: session.id,
            phase: session.currentPhase,
            memory: await this.searchRelevantMemory(request.file, request.action),
            scopeStatus: {
              level: scopeStatus.level,
              message: scopeStatus.message || '',
              visualization: scopeStatus.visualization
            }
          }
        };
      }

      if (scopeStatus.level === 'orange') {
        log.warn(`⚠️ SCOPE WARNING: ${scopeStatus.message}`);
      }
    }

    // Check M7 compliance
    const compliance = await this.orchestrator.enforceM7Compliance(
      'implementation' as 'implementation' | 'code_change' | 'file_edit',
      session.id
    );

    if (!compliance.allowed && this.enforcementLevel !== 'off') {
      this.stats.blocked++;
      return {
        allowed: false,
        reason: compliance.reason || 'M7 compliance check failed',
        requiredActions: compliance.requiredActions
      };
    }

    // Search relevant memory
    const memoryContext = await this.searchRelevantMemory(request.file, request.action);

    this.stats.allowed++;
    const status = this.scopeGuard.getStatus(session.id);
    return {
      allowed: true,
      context: {
        session: session.id,
        phase: session.currentPhase,
        memory: memoryContext,
        scopeStatus: session.id && status ? {
          level: status.level,
          message: status.message || '',
          visualization: status.visualization
        } : undefined
      }
    };
  }

  /**
   * v5.0: Автоматический поиск релевантной памяти using UnifiedMemoryCore
   */
  private async searchRelevantMemory(filePath: string, description: string): Promise<string[]> {
    const insights: string[] = [];
    
    try {
      // Lazy init memory core
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }

      // Поиск по пути файла
      const pathResults = await this.memoryCore.cascadeSearch(filePath, { limit: 5 });
      if (pathResults.length > 0) {
        insights.push(`🗂️ Found ${pathResults.length} patterns related to path '${filePath}'`);
      }

      // Поиск по описанию действия
      if (description && description.length > 10) {
        const actionResults = await this.memoryCore.cascadeSearch(description, { limit: 5 });
        if (actionResults.length > 0) {
          insights.push(`🔍 Found ${actionResults.length} relevant patterns for: "${description}"`);
        }
      }

      // v5.0: Check FogOfWar subsystem
      const stats = await this.memoryCore.getStats();
      if (stats.fogOfWar && stats.fogOfWar.totalEntries > 0) {
        insights.push(`🌫️ Fog of War: ${stats.fogOfWar.totalEntries} technical discoveries tracked`);
      }

    } catch (error) {
      log.error('Memory search failed:', error);
      insights.push('⚠️ Memory search encountered issues - proceed with caution');
    }

    return insights;
  }

  /**
   * Установить уровень принуждения
   */
  setEnforcementLevel(level: EnforcementLevel): void {
    this.enforcementLevel = level;
  }

  /**
   * Получить статистику перехватов
   */
  getInterceptionStats() {
    return {
      ...this.stats,
      enforcementLevel: this.enforcementLevel,
      activeSessions: this.orchestrator.getAllActiveSessions().length,
      message: this.enforcementLevel === 'strict' 
        ? '🛡️ M7 Protection: ACTIVE - All code changes enforced'
        : this.enforcementLevel === 'moderate'
        ? '⚠️ M7 Protection: MODERATE - Violations logged'
        : '🚫 M7 Protection: DISABLED - No enforcement'
    };
  }

  getEnforcementStatus(): string {
    return this.enforcementLevel === 'strict'
      ? 'Full enforcement active'
      : this.enforcementLevel === 'moderate'
      ? 'Moderate enforcement (warnings only)'
      : 'Enforcement disabled';
  }
} 