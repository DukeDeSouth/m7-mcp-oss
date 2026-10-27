/**
 * M7 v3.0 - Session Analyzer
 * 
 * Analyzes completed sessions to extract patterns and outcomes.
 */

import { 
  SessionRecord, 
  SessionAction, 
  SessionOutcomes, 
  SessionViolation 
} from './types.js';

interface TaskSession {
  id: string;
  taskDescription: string;
  route: 'light' | 'medium' | 'heavy';
  currentPhase: string;
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
}

export class SessionAnalyzer {
  private projectId: string;

  constructor(projectId?: string) {
    this.projectId = projectId || this.extractProjectId();
  }

  /**
   * Analyze a completed TaskSession and create SessionRecord
   */
  analyze(session: TaskSession, actions: SessionAction[]): SessionRecord {
    const endTime = new Date();
    const outcomes = this.calculateOutcomes(actions, session.startTime, endTime);
    
    return {
      id: session.id,
      projectId: this.projectId,
      startTime: session.startTime,
      endTime,
      taskDescription: session.taskDescription,
      route: session.route,
      finalPhase: session.currentPhase,
      completedRequirements: this.getCompletedRequirements(session),
      violations: session.violations.map(v => ({
        phase: v.phase,
        reason: v.reason,
        timestamp: v.timestamp
      })),
      actions,
      outcomes,
      insights: []  // Will be filled by InsightExtractor
    };
  }

  /**
   * Calculate session outcomes from actions
   */
  private calculateOutcomes(
    actions: SessionAction[], 
    startTime: Date, 
    endTime: Date
  ): SessionOutcomes {
    const filesModified = new Set<string>();
    let testsRun = 0;
    let testsPassed = 0;
    let errorsFixed = 0;
    let newErrors = 0;
    let successCount = 0;

    for (const action of actions) {
      if (action.file) filesModified.add(action.file);
      
      if (action.type === 'test') {
        testsRun++;
        if (action.success) testsPassed++;
      }
      
      if (action.type === 'fix' && action.success) {
        errorsFixed++;
      }
      
      if (!action.success && action.type === 'generation') {
        newErrors++;
      }
      
      if (action.success) successCount++;
    }

    const sessionDuration = endTime.getTime() - startTime.getTime();
    const toolCallsCount = actions.filter(a => a.type === 'tool_call').length;
    const successRate = actions.length > 0 ? successCount / actions.length : 0;

    return {
      filesModified: Array.from(filesModified),
      linesAdded: 0,  // Would need git integration
      linesRemoved: 0,
      testsRun,
      testsPassed,
      errorsFixed,
      newErrors,
      sessionDuration,
      toolCallsCount,
      successRate
    };
  }

  /**
   * Get completed requirements from session
   */
  private getCompletedRequirements(session: TaskSession): string[] {
    return Object.entries(session.phaseRequirements)
      .filter(([_, completed]) => completed)
      .map(([req, _]) => req);
  }

  /**
   * Extract project ID from current working directory
   */
  private extractProjectId(): string {
    const cwd = process.cwd();
    return cwd.split('/').pop() || 'unknown';
  }

  /**
   * Identify patterns in session actions
   */
  identifyPatterns(actions: SessionAction[]): Map<string, number> {
    const patterns = new Map<string, number>();
    
    // Count tool usage patterns
    for (const action of actions) {
      if (action.tool) {
        const key = `tool:${action.tool}`;
        patterns.set(key, (patterns.get(key) || 0) + 1);
      }
      
      // Count action type patterns
      const typeKey = `type:${action.type}`;
      patterns.set(typeKey, (patterns.get(typeKey) || 0) + 1);
    }

    // Detect sequences (e.g., fix → test → fix)
    for (let i = 0; i < actions.length - 1; i++) {
      const sequence = `${actions[i].type}→${actions[i+1].type}`;
      patterns.set(sequence, (patterns.get(sequence) || 0) + 1);
    }

    // Detect three-step sequences for common workflows
    for (let i = 0; i < actions.length - 2; i++) {
      const sequence = `${actions[i].type}→${actions[i+1].type}→${actions[i+2].type}`;
      patterns.set(sequence, (patterns.get(sequence) || 0) + 1);
    }

    return patterns;
  }

  /**
   * Detect workflow style from actions
   */
  detectWorkflowStyle(actions: SessionAction[]): string {
    const testFirst = actions.findIndex(a => a.type === 'test');
    const codeFirst = actions.findIndex(a => a.type === 'generation');
    
    // TDD detection
    if (testFirst !== -1 && (codeFirst === -1 || testFirst < codeFirst)) {
      return 'TDD';
    }
    
    const fixCount = actions.filter(a => a.type === 'fix').length;
    const genCount = actions.filter(a => a.type === 'generation').length;
    
    // Fix-heavy workflow
    if (fixCount > genCount) {
      return 'iterative-fix';
    }
    
    // Review-heavy workflow
    const reviewCount = actions.filter(a => a.type === 'review').length;
    if (reviewCount > genCount / 2) {
      return 'review-driven';
    }
    
    return 'generation-first';
  }

  /**
   * Calculate session quality score
   */
  calculateQualityScore(record: SessionRecord): number {
    let score = 0;
    const { outcomes, violations } = record;
    
    // Success rate (0-30 points)
    score += outcomes.successRate * 30;
    
    // Test coverage (0-20 points)
    if (outcomes.testsRun > 0) {
      const testSuccessRate = outcomes.testsPassed / outcomes.testsRun;
      score += testSuccessRate * 20;
    }
    
    // Error fixing (0-20 points)
    if (outcomes.errorsFixed > 0) {
      const errorRatio = outcomes.errorsFixed / (outcomes.errorsFixed + outcomes.newErrors);
      score += errorRatio * 20;
    } else if (outcomes.newErrors === 0) {
      score += 20; // No errors at all
    }
    
    // Violations penalty (-5 per violation)
    score -= violations.length * 5;
    
    // Completion bonus (0-10 points)
    if (record.finalPhase === 'completed') {
      score += 10;
    } else if (record.finalPhase === 'validation') {
      score += 5;
    }
    
    // Requirements completion (0-20 points)
    const reqScore = record.completedRequirements.length / 
      Math.max(record.completedRequirements.length + violations.length, 1);
    score += reqScore * 20;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Detect session anomalies
   */
  detectAnomalies(record: SessionRecord): string[] {
    const anomalies: string[] = [];
    const { actions, outcomes, violations } = record;
    
    // Very short session with many actions
    if (outcomes.sessionDuration < 60000 && actions.length > 20) {
      anomalies.push('Unusually high action rate');
    }
    
    // Many violations
    if (violations.length > 3) {
      anomalies.push('Multiple M7 violations');
    }
    
    // Low success rate with many attempts
    if (outcomes.successRate < 0.3 && actions.length > 10) {
      anomalies.push('Persistent failures pattern');
    }
    
    // Repetitive tool calls (potential loop)
    const toolCounts = new Map<string, number>();
    for (const action of actions) {
      if (action.tool) {
        toolCounts.set(action.tool, (toolCounts.get(action.tool) || 0) + 1);
      }
    }
    for (const [tool, count] of toolCounts) {
      if (count > 10) {
        anomalies.push(`Repetitive ${tool} calls (${count}x)`);
      }
    }
    
    // Long gaps between actions
    for (let i = 1; i < actions.length; i++) {
      const gap = new Date(actions[i].timestamp).getTime() - 
                  new Date(actions[i-1].timestamp).getTime();
      if (gap > 30 * 60 * 1000) { // 30 minutes
        anomalies.push('Long idle period detected');
        break;
      }
    }
    
    return anomalies;
  }
}

