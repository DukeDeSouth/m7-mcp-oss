import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[CrossSession]');
/**
 * M7 v3.0 - Cross-Session Learning
 * 
 * Main API for cross-session learning system.
 * Learns from session patterns, accumulates knowledge,
 * and provides context for AI prompts.
 */

export * from './types.js';
export { SessionAnalyzer } from './session-analyzer.js';
export { InsightExtractor } from './insight-extractor.js';
export { KnowledgeAccumulator } from './knowledge-accumulator.js';

import * as path from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';
import { SessionAnalyzer } from './session-analyzer.js';
import { InsightExtractor } from './insight-extractor.js';
import { KnowledgeAccumulator } from './knowledge-accumulator.js';
import { 
  SessionRecord, 
  SessionAction, 
  Insight, 
  CrossSessionConfig, 
  DEFAULT_CONFIG, 
  LearningStats,
  ProjectContext,
  RelevantKnowledge,
  CIResult
} from './types.js';

// TaskSession interface (from orchestrator)
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

export class CrossSessionLearning {
  private analyzer: SessionAnalyzer;
  private extractor: InsightExtractor;
  private accumulator: KnowledgeAccumulator;
  private config: CrossSessionConfig;
  
  private currentSessionActions: SessionAction[] = [];
  private currentSessionId: string | null = null;
  private initialized: boolean = false;

  constructor(config: Partial<CrossSessionConfig> = {}, projectPath: string = getProjectPath()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.analyzer = new SessionAnalyzer(path.basename(projectPath) || 'unknown');
    this.extractor = new InsightExtractor(this.config.insightThreshold);
    this.accumulator = new KnowledgeAccumulator(this.config, projectPath);
  }

  /**
   * Initialize the cross-session learning system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.accumulator.initialize();
    this.initialized = true;
    log.debug('CrossSessionLearning] ✓ Initialized');
  }

  /**
   * Ensure initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ============================================
  // SESSION TRACKING
  // ============================================

  /**
   * Start tracking a new session
   */
  startSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.currentSessionActions = [];
    log.debug(`CrossSessionLearning] ▶ Started tracking session: ${sessionId}`);
  }

  /**
   * Record an action in the current session
   */
  recordAction(action: Omit<SessionAction, 'id' | 'timestamp'>): void {
    if (!this.config.autoRecord) return;
    if (!this.currentSessionId) {
      log.warn('CrossSessionLearning] No active session to record action');
      return;
    }
    
    const fullAction: SessionAction = {
      ...action,
      id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date()
    };
    
    this.currentSessionActions.push(fullAction);
  }

  /**
   * End session and extract insights
   */
  async endSession(session: TaskSession): Promise<{
    record: SessionRecord;
    newInsights: Insight[];
    qualityScore: number;
  }> {
    await this.ensureInitialized();
    
    // Analyze session
    const record = this.analyzer.analyze(session, this.currentSessionActions);
    
    // Calculate quality score
    const qualityScore = this.analyzer.calculateQualityScore(record);
    
    // Extract insights
    let insights = this.extractor.extract(record);
    
    // Merge similar insights
    insights = this.extractor.mergeSimilarInsights(insights);
    
    // Add to record
    record.insights = insights;
    
    // Store insights
    await this.accumulator.storeInsights(insights);
    
    // Clear current session
    const sessionId = this.currentSessionId;
    this.currentSessionId = null;
    this.currentSessionActions = [];

    log.debug(`CrossSessionLearning] ■ Session ${sessionId} ended: ${insights.length} insights extracted, quality: ${qualityScore.toFixed(0)}/100`);

    return {
      record,
      newInsights: insights,
      qualityScore
    };
  }

  /**
   * Get current session info
   */
  getCurrentSession(): { id: string | null; actionsCount: number } {
    return {
      id: this.currentSessionId,
      actionsCount: this.currentSessionActions.length
    };
  }

  // ============================================
  // KNOWLEDGE RETRIEVAL
  // ============================================

  /**
   * Get full project context for AI prompts
   */
  async getContext(): Promise<ProjectContext> {
    await this.ensureInitialized();
    return this.accumulator.getContext();
  }

  /**
   * Get relevant knowledge for a specific query
   */
  async getRelevantKnowledge(query: string, limit: number = 5): Promise<RelevantKnowledge> {
    await this.ensureInitialized();
    return this.accumulator.getRelevantKnowledge(query, limit);
  }

  /**
   * Format context for injection into AI prompt
   */
  async formatContextForPrompt(query?: string): Promise<string> {
    await this.ensureInitialized();
    
    const context = await this.getContext();
    let relevant: RelevantKnowledge | null = null;
    
    if (query) {
      relevant = await this.getRelevantKnowledge(query, 3);
    }
    
    let prompt = '## Learned Project Knowledge\n\n';
    
    // Golden rules (always include)
    if (context.goldenRules.length > 0) {
      prompt += '### 🏆 Golden Rules (High-Confidence Patterns)\n';
      for (const rule of context.goldenRules.slice(0, 3)) {
        prompt += `- ${rule.pattern}\n`;
      }
      prompt += '\n';
    }
    
    // Known issues
    if (context.knownIssues.length > 0) {
      prompt += '### ⚠️ Known Issues to Avoid\n';
      for (const issue of context.knownIssues.slice(0, 3)) {
        prompt += `- ${issue}\n`;
      }
      prompt += '\n';
    }
    
    // Query-specific knowledge
    if (relevant && relevant.insights.length > 0) {
      prompt += '### 💡 Relevant Insights\n';
      for (const insight of relevant.insights) {
        const confidence = Math.round(insight.confidenceEma * 100);
        prompt += `- [${confidence}%] ${insight.content}\n`;
      }
      prompt += '\n';
    }
    
    // Common patterns
    if (context.commonPatterns.length > 0) {
      prompt += '### 🔄 Common Patterns\n';
      for (const pattern of context.commonPatterns.slice(0, 3)) {
        prompt += `- ${pattern}\n`;
      }
      prompt += '\n';
    }
    
    return prompt;
  }

  // ============================================
  // VALIDATION & FEEDBACK
  // ============================================

  /**
   * Record CI/CD result for validation
   */
  async recordCIResult(result: CIResult): Promise<void> {
    await this.ensureInitialized();
    
    if (result.affectedInsights) {
      for (const insightId of result.affectedInsights) {
        await this.accumulator.validateInsight(insightId, result.success, 'ci');
      }
    }
    
    log.debug(`CrossSessionLearning] ${result.success ? '✓' : '✗'} CI result recorded: ${result.type}`);
  }

  /**
   * Manual insight validation (user feedback)
   */
  async validateInsight(insightId: string, valid: boolean): Promise<void> {
    await this.ensureInitialized();
    await this.accumulator.validateInsight(insightId, valid, 'user');
  }

  /**
   * Record user feedback on an action
   */
  recordFeedback(actionId: string, feedback: 'positive' | 'negative' | 'neutral'): void {
    const action = this.currentSessionActions.find(a => a.id === actionId);
    if (action) {
      action.userFeedback = feedback;
    }
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get learning statistics
   */
  async getStats(): Promise<LearningStats> {
    await this.ensureInitialized();
    return this.accumulator.getStats();
  }

  /**
   * Cleanup old data
   */
  async cleanup(options?: { olderThanDays?: number; belowConfidence?: number }): Promise<number> {
    await this.ensureInitialized();
    return this.accumulator.cleanup(options);
  }

  /**
   * Check if system is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

// One instance per project: knowledge learned in one project is stored and read there only.
const instances = new Map<string, CrossSessionLearning>();

export function getCrossSessionLearning(config?: Partial<CrossSessionConfig>): CrossSessionLearning {
  const projectPath = getProjectPath();
  let instance = instances.get(projectPath);
  if (!instance) {
    instance = new CrossSessionLearning(config, projectPath);
    instances.set(projectPath, instance);
  }
  return instance;
}

export function resetCrossSessionLearning(): void {
  instances.clear();
}

