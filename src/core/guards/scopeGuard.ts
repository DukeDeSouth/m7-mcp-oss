import { TaskOrchestrator } from '../orchestrator/taskOrchestrator.js';
import { JournalSystem } from '../../journal/journalSystem.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';

export interface ScopeBudget {
  maxFiles: number;
  maxLines: number;
  maxBreaking: number;
  maxMinutes: number;
}

export interface FileChange {
  file: string;
  linesAdded: number;
  linesRemoved: number;
  type: 'create' | 'modify' | 'delete';
  isBreaking?: boolean;
}

export interface ScopeMetrics {
  budget: ScopeBudget;
  filesChanged: Set<string>;
  linesAdded: number;
  linesRemoved: number;
  breakingChanges: FileChange[];
  startTime: number;
  warnings: ScopeWarning[];
}

export interface ScopeWarning {
  level: 'yellow' | 'orange' | 'red';
  message: string;
  timestamp: number;
  metric: string;
}

export interface ScopeStatus {
  level: 'green' | 'yellow' | 'orange' | 'red';
  action?: 'monitor' | 'warn' | 'warn-strong' | 'block';
  message?: string;
  metrics?: {
    filesUsed: number;
    filesMax: number;
    linesUsed: number;
    linesMax: number;
    breakingUsed: number;
    breakingMax: number;
    timeUsed: number;
    timeMax: number;
  };
  visualization?: string;
}

export class ScopeGuard {
  private sessions: Map<string, ScopeMetrics> = new Map();
  private overrideHistory: Map<string, string[]> = new Map();
  private memoryCore: UnifiedMemoryCore | null = null;

  constructor(
    private orchestrator: TaskOrchestrator,
    private journal: JournalSystem
  ) {}

  /**
   * Start monitoring a session with given budget
   */
  async startMonitoring(sessionId: string, budget: ScopeBudget): Promise<void> {
    this.sessions.set(sessionId, {
      budget,
      filesChanged: new Set(),
      linesAdded: 0,
      linesRemoved: 0,
      breakingChanges: [],
      startTime: Date.now(),
      warnings: []
    });

    // v5.0: Store in unified memory for learning
    try {
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          content: `Scope monitoring started for session ${sessionId}`,
          context: { budget, timestamp: Date.now() }
        }),
        {
          level: 'L0',
          source: 'runtime',
          contextKeys: ['scope', 'session', sessionId],
          confidence: 0.8
        }
      );
    } catch (error) {
      // Non-critical, continue without memory storage
    }
  }

  /**
   * Track a file change and return current status
   */
  trackChange(sessionId: string, change: FileChange): ScopeStatus {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) {
      return { 
        level: 'green', 
        message: 'No active scope monitoring for this session' 
      };
    }

    // Update metrics
    metrics.filesChanged.add(change.file);
    metrics.linesAdded += change.linesAdded;
    metrics.linesRemoved += change.linesRemoved;

    // Check if breaking change
    if (this.isBreakingChange(change)) {
      metrics.breakingChanges.push(change);
    }

    // Calculate and return status
    const status = this.calculateStatus(sessionId, metrics);

    // Record warning if needed
    if (status.level !== 'green' && !this.hasRecentWarning(metrics, status.level)) {
      metrics.warnings.push({
        level: status.level as 'yellow' | 'orange' | 'red',
        message: status.message || '',
        timestamp: Date.now(),
        metric: this.getHighestRatioMetric(metrics)
      });
    }

    return status;
  }

  /**
   * Get current status for a session
   */
  getStatus(sessionId: string): ScopeStatus {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) {
      return { level: 'green', message: 'No active monitoring' };
    }

    const status = this.calculateStatus(sessionId, metrics);
    status.visualization = this.getVisualization(sessionId);
    return status;
  }

  /**
   * Request scope extension with justification
   */
  async requestExtension(
    sessionId: string, 
    extension: Partial<ScopeBudget>, 
    reason: string
  ): Promise<boolean> {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) return false;

    // Auto-approve certain reasons
    const autoApprovePatterns = [
      /security[- ]?fix/i,
      /production[- ]?hotfix/i,
      /critical[- ]?bug/i,
      /breaking[- ]?change[- ]?required/i
    ];

    const autoApproved = autoApprovePatterns.some(pattern => pattern.test(reason));

    if (autoApproved) {
      // Apply extension
      Object.assign(metrics.budget, extension);
      
      // v5.0: Log for learning in unified memory
      try {
        if (!this.memoryCore) {
          this.memoryCore = await getMemoryCore();
        }
        await this.memoryCore.store(
          JSON.stringify({
            content: `Auto-approved scope extension: ${reason}`,
            context: { extension, autoApproved: true }
          }),
          {
            level: 'L1',
            source: 'runtime',
            contextKeys: ['scope', 'extension', sessionId],
            confidence: 0.9
          }
        );
      } catch (error) {
        // Non-critical
      }

      return true;
    }

    // Manual approval flow (for now, always approve with logging)
    Object.assign(metrics.budget, extension);

    // Track override patterns
    const overrides = this.overrideHistory.get(sessionId) || [];
    overrides.push(reason);
    this.overrideHistory.set(sessionId, overrides);

    try {
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          content: `Scope extension requested: ${reason}`,
          context: { extension, autoApproved: false }
        }),
        {
          level: 'L1',
          source: 'runtime',
          contextKeys: ['scope', 'extension', sessionId],
          confidence: 0.8
        }
      );
    } catch (error) {
      // Non-critical
    }

    return true;
  }

  /**
   * Get visual representation of current scope usage
   */
  getVisualization(sessionId: string): string {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) return 'No active monitoring';

    const filePercent = Math.min(100, (metrics.filesChanged.size / metrics.budget.maxFiles) * 100);
    const linePercent = Math.min(100, (metrics.linesAdded / metrics.budget.maxLines) * 100);
    const timePercent = Math.min(100, ((Date.now() - metrics.startTime) / (metrics.budget.maxMinutes * 60000)) * 100);

    const getBar = (percent: number) => {
      const filled = Math.floor(percent / 10);
      const empty = 10 - filled;
      return '█'.repeat(filled) + '░'.repeat(empty);
    };

    const getEmoji = (percent: number) => {
      if (percent >= 95) return '🔴';
      if (percent >= 80) return '🟠';
      if (percent >= 50) return '🟡';
      return '🟢';
    };

    return `
📊 Scope Status:
📁 Files:  ${getBar(filePercent)} ${Math.round(filePercent)}% ${getEmoji(filePercent)}
📝 Lines:  ${getBar(linePercent)} ${Math.round(linePercent)}% ${getEmoji(linePercent)}
⏱️  Time:   ${getBar(timePercent)} ${Math.round(timePercent)}% ${getEmoji(timePercent)}
⚡ Breaking: ${metrics.breakingChanges.length}/${metrics.budget.maxBreaking}
    `.trim();
  }

  /**
   * Complete monitoring for a session
   */
  async completeSession(sessionId: string): Promise<void> {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) return;

    // Calculate final stats
    const finalStatus = this.calculateStatus(sessionId, metrics);
    const keptWithinBudget = finalStatus.level !== 'red';
    const overrunPercentage = this.calculateOverrun(metrics);

    // v5.0: Store completion data in unified memory for learning
    try {
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          content: `Session ${sessionId} completed`,
          context: {
            keptWithinBudget,
            overrunPercentage,
            finalMetrics: {
              files: metrics.filesChanged.size,
              lines: metrics.linesAdded,
              breaking: metrics.breakingChanges.length,
              duration: Date.now() - metrics.startTime
            },
            warnings: metrics.warnings.length,
            overrides: this.overrideHistory.get(sessionId) || []
          }
        }),
        {
          level: 'L2',
          source: 'runtime',
          contextKeys: ['scope', 'completion', sessionId],
          confidence: 1.0
        }
      );
    } catch (error) {
      // Non-critical
    }

    // Clean up
    this.sessions.delete(sessionId);
    this.overrideHistory.delete(sessionId);
  }

  // Private helper methods

  private calculateStatus(sessionId: string, metrics: ScopeMetrics): ScopeStatus {
    const fileRatio = metrics.filesChanged.size / metrics.budget.maxFiles;
    const lineRatio = metrics.linesAdded / metrics.budget.maxLines;
    const breakingRatio = metrics.budget.maxBreaking > 0 
      ? metrics.breakingChanges.length / metrics.budget.maxBreaking 
      : metrics.breakingChanges.length > 0 ? 1 : 0;
    const timeRatio = (Date.now() - metrics.startTime) / (metrics.budget.maxMinutes * 60000);

    const maxRatio = Math.max(fileRatio, lineRatio, breakingRatio, timeRatio);

    const status: ScopeStatus = {
      level: 'green',
      metrics: {
        filesUsed: metrics.filesChanged.size,
        filesMax: metrics.budget.maxFiles,
        linesUsed: metrics.linesAdded,
        linesMax: metrics.budget.maxLines,
        breakingUsed: metrics.breakingChanges.length,
        breakingMax: metrics.budget.maxBreaking,
        timeUsed: Math.round((Date.now() - metrics.startTime) / 60000),
        timeMax: metrics.budget.maxMinutes
      }
    };

    if (maxRatio >= 0.95) {
      status.level = 'red';
      status.action = 'block';
      status.message = '🚨 SCOPE LIMIT EXCEEDED. Commit current work or request extension.';
    } else if (maxRatio >= 0.8) {
      status.level = 'orange';
      status.action = 'warn-strong';
      status.message = '⚠️ Approaching scope limits. Consider wrapping up.';
    } else if (maxRatio >= 0.5) {
      status.level = 'yellow';
      status.action = 'warn';
      status.message = '📊 Halfway through scope budget. Stay focused.';
    } else {
      status.action = 'monitor';
    }

    // Don't set visualization here, it's set in the calling methods

    return status;
  }

  private isBreakingChange(change: FileChange): boolean {
    // Check if explicitly marked as breaking
    if (change.isBreaking) return true;

    // Heuristics for breaking changes
    const breakingPatterns = [
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /export\s+(class|function|const|interface|type)/,
      /\.d\.ts$/
    ];

    // Check file path and content indicators
    return breakingPatterns.some(pattern => pattern.test(change.file));
  }

  private hasRecentWarning(metrics: ScopeMetrics, level: string): boolean {
    const recentThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    return metrics.warnings.some(w => 
      w.level === level && (now - w.timestamp) < recentThreshold
    );
  }

  private getHighestRatioMetric(metrics: ScopeMetrics): string {
    const ratios = {
      files: metrics.filesChanged.size / metrics.budget.maxFiles,
      lines: metrics.linesAdded / metrics.budget.maxLines,
      breaking: metrics.budget.maxBreaking > 0 
        ? metrics.breakingChanges.length / metrics.budget.maxBreaking 
        : 0,
      time: (Date.now() - metrics.startTime) / (metrics.budget.maxMinutes * 60000)
    };

    let highest = 'files';
    let highestValue = 0;

    for (const [key, value] of Object.entries(ratios)) {
      if (value > highestValue) {
        highest = key;
        highestValue = value;
      }
    }

    return highest;
  }

  private calculateOverrun(metrics: ScopeMetrics): number {
    const fileRatio = metrics.filesChanged.size / metrics.budget.maxFiles;
    const lineRatio = metrics.linesAdded / metrics.budget.maxLines;
    const breakingRatio = metrics.budget.maxBreaking > 0 
      ? metrics.breakingChanges.length / metrics.budget.maxBreaking 
      : 0;
    const timeRatio = (Date.now() - metrics.startTime) / (metrics.budget.maxMinutes * 60000);

    return Math.max(fileRatio, lineRatio, breakingRatio, timeRatio);
  }
} 