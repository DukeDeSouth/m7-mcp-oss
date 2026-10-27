import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[AgentMemory]');

/**
 * M7 Hive - Agent Memory System
 * 
 * Enables agents to remember context across task executions within a session.
 * Tracks successful patterns and approaches per agent role.
 * 
 * @version 3.9.0
 */

import { randomUUID } from 'crypto';

/**
 * Single execution record
 */
export interface ExecutionRecord {
  id: string;
  timestamp: Date;
  taskDescription: string;
  agentRole: string;
  approach: string;
  result: string;
  success: boolean;
  confidence: number;
  tokensUsed: number;
  latencyMs: number;
}

/**
 * Agent memory summary for prompt injection
 */
export interface AgentMemorySummary {
  role: string;
  totalExecutions: number;
  successRate: number;
  recentSuccesses: string[];
  recentFailures: string[];
  learnedPatterns: string[];
}

/**
 * Session-level agent memory
 */
export class AgentMemory {
  private executions: Map<string, ExecutionRecord[]> = new Map(); // role -> executions
  private patterns: Map<string, Set<string>> = new Map(); // role -> learned patterns
  private maxHistoryPerRole: number;
  private maxPatternsPerRole: number;
  
  constructor(options: {
    maxHistoryPerRole?: number;
    maxPatternsPerRole?: number;
  } = {}) {
    this.maxHistoryPerRole = options.maxHistoryPerRole || 10;
    this.maxPatternsPerRole = options.maxPatternsPerRole || 5;
  }
  
  /**
   * Record an execution result
   */
  recordExecution(
    agentRole: string,
    taskDescription: string,
    approach: string,
    result: string,
    success: boolean,
    metrics: {
      confidence?: number;
      tokensUsed?: number;
      latencyMs?: number;
    } = {}
  ): void {
    const record: ExecutionRecord = {
      id: randomUUID(),
      timestamp: new Date(),
      taskDescription,
      agentRole,
      approach,
      result: result.substring(0, 1000), // Truncate long results
      success,
      confidence: metrics.confidence || 0.5,
      tokensUsed: metrics.tokensUsed || 0,
      latencyMs: metrics.latencyMs || 0
    };
    
    // Get or create execution history for this role
    let roleHistory = this.executions.get(agentRole);
    if (!roleHistory) {
      roleHistory = [];
      this.executions.set(agentRole, roleHistory);
    }
    
    roleHistory.push(record);
    
    // Trim to max history
    if (roleHistory.length > this.maxHistoryPerRole) {
      roleHistory.shift();
    }
    
    // Extract patterns from successful executions
    if (success) {
      this.extractPattern(agentRole, approach, taskDescription);
    }
    
    log.debug(`[AgentMemory] 📝 Recorded ${success ? '✅' : '❌'} execution for ${agentRole}`);
  }
  
  /**
   * Extract and store successful pattern
   */
  private extractPattern(role: string, approach: string, task: string): void {
    // Get key terms from approach
    const words = approach.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4);
    
    // Create pattern signature
    const uniqueWords = [...new Set(words)].slice(0, 5);
    if (uniqueWords.length < 2) return;
    
    const patternKey = uniqueWords.sort().join('-');
    
    let rolePatterns = this.patterns.get(role);
    if (!rolePatterns) {
      rolePatterns = new Set();
      this.patterns.set(role, rolePatterns);
    }
    
    rolePatterns.add(patternKey);
    
    // Trim to max patterns (keep newest by recreating set)
    if (rolePatterns.size > this.maxPatternsPerRole) {
      const arr = Array.from(rolePatterns);
      this.patterns.set(role, new Set(arr.slice(-this.maxPatternsPerRole)));
    }
  }
  
  /**
   * Get memory summary for an agent role
   */
  getSummary(agentRole: string): AgentMemorySummary | null {
    const history = this.executions.get(agentRole);
    if (!history || history.length === 0) {
      return null;
    }
    
    const successes = history.filter(e => e.success);
    const failures = history.filter(e => !e.success);
    
    return {
      role: agentRole,
      totalExecutions: history.length,
      successRate: successes.length / history.length,
      recentSuccesses: successes.slice(-3).map(e => 
        `${e.taskDescription.substring(0, 50)}: ${e.approach.substring(0, 100)}`
      ),
      recentFailures: failures.slice(-2).map(e => 
        `${e.taskDescription.substring(0, 50)}: ${e.result.substring(0, 100)}`
      ),
      learnedPatterns: Array.from(this.patterns.get(agentRole) || [])
    };
  }
  
  /**
   * Get memory injection for agent prompt
   */
  getPromptInjection(agentRole: string): string {
    const summary = this.getSummary(agentRole);
    if (!summary || summary.totalExecutions < 2) {
      return '';
    }
    
    let injection = '\n\n## Session Memory\n\n';
    injection += `You have completed ${summary.totalExecutions} tasks this session `;
    injection += `(${Math.round(summary.successRate * 100)}% success rate).\n\n`;
    
    if (summary.recentSuccesses.length > 0) {
      injection += '### Successful Approaches\n';
      summary.recentSuccesses.forEach((s, i) => {
        injection += `${i + 1}. ${s}\n`;
      });
      injection += '\n';
    }
    
    if (summary.recentFailures.length > 0) {
      injection += '### Avoid These Mistakes\n';
      summary.recentFailures.forEach((f, i) => {
        injection += `${i + 1}. ${f}\n`;
      });
      injection += '\n';
    }
    
    injection += '*Use your session experience to improve this task.*\n';
    
    return injection;
  }
  
  /**
   * Get similar task from history
   */
  findSimilarTask(agentRole: string, taskDescription: string): ExecutionRecord | null {
    const history = this.executions.get(agentRole);
    if (!history) return null;
    
    // Simple keyword matching
    const taskWords = new Set(
      taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    
    let bestMatch: ExecutionRecord | null = null;
    let bestScore = 0;
    
    for (const record of history) {
      const recordWords = new Set(
        record.taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      );
      
      let matchCount = 0;
      for (const word of taskWords) {
        if (recordWords.has(word)) matchCount++;
      }
      
      const score = matchCount / taskWords.size;
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = record;
      }
    }
    
    return bestMatch;
  }
  
  /**
   * Get all role statistics
   */
  getAllStats(): Record<string, { executions: number; successRate: number }> {
    const stats: Record<string, { executions: number; successRate: number }> = {};
    
    for (const [role, history] of this.executions) {
      const successes = history.filter(e => e.success).length;
      stats[role] = {
        executions: history.length,
        successRate: history.length > 0 ? successes / history.length : 0
      };
    }
    
    return stats;
  }
  
  /**
   * Clear memory (for testing or reset)
   */
  clear(): void {
    this.executions.clear();
    this.patterns.clear();
  }
}

// Singleton instance
let globalAgentMemory: AgentMemory | null = null;

/**
 * Get global agent memory instance
 */
export function getAgentMemory(): AgentMemory {
  if (!globalAgentMemory) {
    globalAgentMemory = new AgentMemory();
    log.debug(`[AgentMemory] 🧠 Initialized session memory`);
  }
  return globalAgentMemory;
}

/**
 * Reset global agent memory (for testing)
 */
export function resetAgentMemory(): void {
  if (globalAgentMemory) {
    globalAgentMemory.clear();
  }
  globalAgentMemory = null;
}
