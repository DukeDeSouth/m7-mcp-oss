/**
 * M7 Hive v2.0 - Self-Learning System
 * 
 * Logs agent executions and learns from results to improve
 * model selection over time.
 * 
 * Data is stored in:
 * - .m7/hive-learning.jsonl - Execution logs
 * - .m7/hive-adjustments.json - Computed adjustments
 * 
 * @version 3.10.0
 * v3.10.0: Added atomic writes for crash safety
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  ExecutionLog, 
  LearningAdjustment, 
  LearningState,
  DynamicAgent,
  AgentDomain 
} from './types.js';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
import { randomUUID } from 'crypto';
import { atomicWriteJSON, safeReadJSON } from '../../core/utils/atomicWrite.js';

const LEARNING_LOG_FILE = 'hive-learning.jsonl';
const ADJUSTMENTS_FILE = 'hive-adjustments.json';
const MIN_SAMPLES_FOR_ADJUSTMENT = 5;  // Need at least 5 samples to make adjustments
const MAX_ADJUSTMENT = 0.2;  // Maximum 20% adjustment
const MAX_LOG_SIZE_BYTES = 500 * 1024;  // 500KB - trigger rotation
const TRIM_TO_LINES = 100;  // Keep last 100 entries after rotation

/**
 * Get the .m7 directory path
 */
function getM7Dir(): string {
  const projectPath = getProjectPath();
  return path.join(projectPath, '.m7');
}

/**
 * Ensure .m7 directory exists
 */
function ensureM7Dir(): void {
  const m7Dir = getM7Dir();
  if (!fs.existsSync(m7Dir)) {
    fs.mkdirSync(m7Dir, { recursive: true });
  }
}

/**
 * Trim log file when it exceeds MAX_LOG_SIZE_BYTES.
 * Keeps only the last TRIM_TO_LINES entries to prevent unbounded growth.
 */
function trimLogFileIfNeeded(logPath: string): void {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size <= MAX_LOG_SIZE_BYTES) return;

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length <= TRIM_TO_LINES) return;

    const trimmed = lines.slice(-TRIM_TO_LINES).join('\n') + '\n';
    fs.writeFileSync(logPath, trimmed, 'utf-8');

    logger.info(`[Self-Learning] Trimmed log from ${lines.length} to ${TRIM_TO_LINES} lines (was ${(stats.size / 1024).toFixed(0)}KB)`);
  } catch {
    // Non-critical — silently ignore trim failures
  }
}

/**
 * Log an agent execution for learning
 */
export async function logExecution(
  task: string,
  agent: DynamicAgent,
  model: string,
  provider: 'openai' | 'anthropic',
  response: string,
  metrics: {
    tokensUsed: number;
    latencyMs: number;
  },
  wasUsedInFinal: boolean
): Promise<void> {
  try {
    ensureM7Dir();
    
    const logEntry: ExecutionLog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      task,
      agent,
      model,
      provider,
      responsePreview: response.substring(0, 500),  // Truncate for storage
      tokensUsed: metrics.tokensUsed,
      latencyMs: metrics.latencyMs,
      wasUsedInFinal
    };
    
    const logPath = path.join(getM7Dir(), LEARNING_LOG_FILE);
    const line = JSON.stringify(logEntry) + '\n';
    
    fs.appendFileSync(logPath, line, 'utf-8');
    trimLogFileIfNeeded(logPath);
    
    logger.info(`[Self-Learning] 📝 Logged execution: ${agent.role} (${model}), used: ${wasUsedInFinal}`);
    
    // Trigger adjustment recalculation periodically (every 10 logs)
    const logCount = await getLogCount();
    if (logCount % 10 === 0) {
      await recalculateAdjustments();
    }
    
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to log execution: ${error.message}`);
  }
}

/**
 * Get count of logged executions
 */
async function getLogCount(): Promise<number> {
  try {
    const logPath = path.join(getM7Dir(), LEARNING_LOG_FILE);
    if (!fs.existsSync(logPath)) return 0;
    
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Read all execution logs
 */
export async function readExecutionLogs(): Promise<ExecutionLog[]> {
  try {
    const logPath = path.join(getM7Dir(), LEARNING_LOG_FILE);
    if (!fs.existsSync(logPath)) return [];
    
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    return lines.map(line => JSON.parse(line) as ExecutionLog);
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to read logs: ${error.message}`);
    return [];
  }
}

/**
 * Recalculate learning adjustments based on execution history
 */
export async function recalculateAdjustments(): Promise<void> {
  try {
    logger.info('[Self-Learning] 🧮 Recalculating adjustments...');
    
    const logs = await readExecutionLogs();
    if (logs.length < MIN_SAMPLES_FOR_ADJUSTMENT) {
      logger.info(`[Self-Learning] Not enough samples (${logs.length}/${MIN_SAMPLES_FOR_ADJUSTMENT})`);
      return;
    }
    
    // Group by model+domain
    const groups = new Map<string, ExecutionLog[]>();
    
    for (const log of logs) {
      const key = `${log.model}:${log.agent.domain}`;
      const existing = groups.get(key) || [];
      existing.push(log);
      groups.set(key, existing);
    }
    
    // Calculate adjustments
    const adjustments: LearningAdjustment[] = [];
    
    for (const [key, groupLogs] of groups.entries()) {
      if (groupLogs.length < MIN_SAMPLES_FOR_ADJUSTMENT) continue;
      
      const [model, domain] = key.split(':') as [string, AgentDomain];
      
      // Calculate success rate (wasUsedInFinal)
      const successRate = groupLogs.filter(l => l.wasUsedInFinal).length / groupLogs.length;
      
      // Calculate quality score based on:
      // - Success rate (50% weight)
      // - User rating if available (30% weight)
      // - Latency efficiency (20% weight)
      
      let qualityScore = successRate * 0.5;
      
      // User ratings
      const ratings = groupLogs.filter(l => l.userRating !== undefined).map(l => l.userRating!);
      if (ratings.length > 0) {
        const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        qualityScore += (avgRating / 5) * 0.3;  // Normalize to 0-1
      } else {
        qualityScore += 0.5 * 0.3;  // Neutral if no ratings
      }
      
      // Latency efficiency (relative to average)
      const avgLatency = groupLogs.reduce((sum, l) => sum + l.latencyMs, 0) / groupLogs.length;
      const allAvgLatency = logs.reduce((sum, l) => sum + l.latencyMs, 0) / logs.length;
      const latencyEfficiency = allAvgLatency / avgLatency;  // Higher is better
      qualityScore += Math.min(latencyEfficiency, 1.5) / 1.5 * 0.2;
      
      // Convert quality score to adjustment (-0.2 to +0.2)
      // Quality 0.5 = no adjustment, 0 = -0.2, 1 = +0.2
      const adjustment = (qualityScore - 0.5) * 2 * MAX_ADJUSTMENT;
      const cappedAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));
      
      adjustments.push({
        model,
        domain,
        adjustment: cappedAdjustment,
        sampleCount: groupLogs.length,
        lastUpdated: new Date().toISOString()
      });
    }
    
    // Save adjustments (v3.10: atomic write with backup)
    const state: LearningState = {
      version: '1.0.0',
      totalExecutions: logs.length,
      adjustments,
      lastUpdated: new Date().toISOString()
    };
    
    const adjustmentsPath = path.join(getM7Dir(), ADJUSTMENTS_FILE);
    const result = await atomicWriteJSON(adjustmentsPath, state, {
      maxBackups: 3,
      createBackup: true,
    });
    
    if (!result.success) {
      throw new Error(`Failed to save adjustments: ${result.error}`);
    }
    
    logger.info(`[Self-Learning] ✅ Saved ${adjustments.length} adjustments from ${logs.length} executions`);
    
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to recalculate: ${error.message}`);
  }
}

/**
 * Get current learning adjustments (v3.10: with backup recovery)
 */
export async function getLearningAdjustments(): Promise<LearningAdjustment[]> {
  try {
    const adjustmentsPath = path.join(getM7Dir(), ADJUSTMENTS_FILE);
    const result = await safeReadJSON<LearningState>(adjustmentsPath);
    
    if (result.recoveredFrom) {
      logger.warn(`[Self-Learning] Adjustments recovered from backup: ${result.recoveredFrom}`);
    }
    
    return result.data?.adjustments || [];
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to get adjustments: ${error.message}`);
    return [];
  }
}

/**
 * Get learning state (v3.10: with backup recovery)
 */
export async function getLearningState(): Promise<LearningState | null> {
  try {
    const adjustmentsPath = path.join(getM7Dir(), ADJUSTMENTS_FILE);
    const result = await safeReadJSON<LearningState>(adjustmentsPath);
    
    if (result.recoveredFrom) {
      logger.warn(`[Self-Learning] Learning state recovered from backup: ${result.recoveredFrom}`);
    }
    
    return result.data || null;
  } catch {
    return null;
  }
}

/**
 * Add user rating to an execution
 */
export async function addUserRating(executionId: string, rating: number): Promise<boolean> {
  try {
    const logPath = path.join(getM7Dir(), LEARNING_LOG_FILE);
    if (!fs.existsSync(logPath)) return false;
    
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    
    let updated = false;
    const newLines = lines.map(line => {
      if (!line.trim()) return line;
      
      try {
        const log: ExecutionLog = JSON.parse(line);
        if (log.id === executionId) {
          log.userRating = Math.max(1, Math.min(5, rating));
          updated = true;
          return JSON.stringify(log);
        }
        return line;
      } catch {
        return line;
      }
    });
    
    if (updated) {
      fs.writeFileSync(logPath, newLines.join('\n'), 'utf-8');
      logger.info(`[Self-Learning] ⭐ Added rating ${rating} to execution ${executionId}`);
      
      // Recalculate adjustments
      await recalculateAdjustments();
    }
    
    return updated;
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to add rating: ${error.message}`);
    return false;
  }
}

/**
 * Clear all learning data (for testing)
 */
export async function clearLearningData(): Promise<void> {
  try {
    const logPath = path.join(getM7Dir(), LEARNING_LOG_FILE);
    const adjustmentsPath = path.join(getM7Dir(), ADJUSTMENTS_FILE);
    
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    if (fs.existsSync(adjustmentsPath)) fs.unlinkSync(adjustmentsPath);
    
    logger.info('[Self-Learning] 🗑️ Cleared all learning data');
  } catch (error: any) {
    logger.warn(`[Self-Learning] Failed to clear data: ${error.message}`);
  }
}

/**
 * Get learning statistics
 */
export async function getLearningStats(): Promise<{
  totalExecutions: number;
  adjustmentsCount: number;
  topModels: Array<{ model: string; domain: string; adjustment: number }>;
  lastUpdated: string | null;
}> {
  const state = await getLearningState();
  
  if (!state) {
    return {
      totalExecutions: 0,
      adjustmentsCount: 0,
      topModels: [],
      lastUpdated: null
    };
  }
  
  const topModels = [...state.adjustments]
    .sort((a, b) => b.adjustment - a.adjustment)
    .slice(0, 5)
    .map(a => ({
      model: a.model,
      domain: a.domain,
      adjustment: a.adjustment
    }));
  
  return {
    totalExecutions: state.totalExecutions,
    adjustmentsCount: state.adjustments.length,
    topModels,
    lastUpdated: state.lastUpdated
  };
}
