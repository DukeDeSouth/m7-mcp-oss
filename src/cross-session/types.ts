/**
 * M7 v3.0 - Cross-Session Learning Types
 * 
 * Type definitions for cross-session learning system.
 * Based on patterns from Emergent Learning Framework (ELF).
 */

// ============================================
// SESSION TYPES
// ============================================

export interface SessionRecord {
  id: string;
  projectId: string;
  startTime: Date;
  endTime: Date;
  taskDescription: string;
  route: 'light' | 'medium' | 'heavy';
  finalPhase: string;
  completedRequirements: string[];
  violations: SessionViolation[];
  actions: SessionAction[];
  outcomes: SessionOutcomes;
  insights: Insight[];
}

export interface SessionViolation {
  phase: string;
  reason: string;
  timestamp: Date;
}

export interface SessionAction {
  id: string;
  timestamp: Date;
  type: ActionType;
  tool?: string;
  input: string;
  output: string;
  file?: string;
  success: boolean;
  duration?: number;
  userFeedback?: UserFeedback;
}

export type ActionType = 'query' | 'generation' | 'fix' | 'review' | 'test' | 'tool_call';
export type UserFeedback = 'positive' | 'negative' | 'neutral';

export interface SessionOutcomes {
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  testsRun: number;
  testsPassed: number;
  errorsFixed: number;
  newErrors: number;
  sessionDuration: number;
  toolCallsCount: number;
  successRate: number;
}

// ============================================
// INSIGHT TYPES
// ============================================

export interface Insight {
  id: string;
  type: InsightType;
  content: string;
  confidence: number;        // 0.0 - 1.0
  confidenceEma: number;     // Exponential moving average (ELF pattern)
  category: string;
  source: InsightSource;
  validation?: InsightValidation;
  createdAt: Date;
  lastUsedAt: Date;
  usageCount: number;
  timesValidated: number;
  timesViolated: number;
}

export type InsightType = 'pattern' | 'preference' | 'knowledge' | 'antipattern' | 'workflow';

export interface InsightSource {
  sessionId: string;
  actionIds: string[];
}

export interface InsightValidation {
  method: ValidationMethod;
  result: boolean;
  timestamp: Date;
  count: number;
}

export type ValidationMethod = 'user' | 'test' | 'ci' | 'repetition';

// ============================================
// GUIDELINE TYPES
// ============================================

export interface ProjectGuideline {
  id: string;
  projectId: string;
  category: string;
  rule: string;
  examples: string[];
  source: GuidelineSource;
  confidence: number;
  createdAt: Date;
  lastValidated: Date;
  validationCount: number;
  failureCount: number;
}

export type GuidelineSource = 'extracted' | 'user' | 'default' | 'ci_validated';

// ============================================
// HEURISTIC TYPES (ELF-inspired)
// ============================================

export interface HeuristicRule {
  id: string;
  domain: string;           // e.g., 'typescript', 'react', 'testing'
  pattern: string;          // What to detect
  action: string;           // What to do
  confidence: number;       // Raw confidence 0.0 - 1.0
  confidenceEma: number;    // Smoothed confidence (ELF pattern)
  emaAlpha: number;         // Learning rate (0.1-0.3)
  emaWarmupRemaining: number; // Warmup period
  triggers: number;         // Total times triggered
  successes: number;        // Successful applications
  failures: number;         // Failed applications
  status: HeuristicStatus;
  promotedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type HeuristicStatus = 'candidate' | 'active' | 'golden' | 'deprecated';

// ============================================
// STATISTICS TYPES
// ============================================

export interface LearningStats {
  totalSessions: number;
  totalInsights: number;
  validatedInsights: number;
  goldenRules: number;
  activeHeuristics: number;
  accuracyTrend: number[];
  topPatterns: PatternStat[];
  improvementAreas: string[];
  lastUpdated: Date;
}

export interface PatternStat {
  pattern: string;
  count: number;
  successRate: number;
}

// ============================================
// CONFIGURATION
// ============================================

export interface CrossSessionConfig {
  enabled: boolean;
  autoRecord: boolean;
  
  // Insight extraction
  insightThreshold: number;           // Min actions for insight extraction
  
  // Confidence settings (ELF-inspired)
  initialConfidence: number;          // Starting confidence for new insights
  confidenceDecayHalfLife: number;    // Days for 50% decay (default: 7)
  minConfidenceThreshold: number;     // Min to keep insight active
  
  // Heuristic promotion (ELF-inspired)
  goldenRuleThreshold: number;        // Confidence to promote to golden (0.9)
  minValidationsForPromotion: number; // Min validations before promotion (3)
  
  // Storage limits
  maxSessionsHistory: number;         // Max sessions to keep
  maxInsightsPerProject: number;      // Max insights per project
  
  // EMA settings
  emaAlphaDefault: number;            // Default learning rate
  emaWarmupPeriod: number;            // Warmup samples
  
  // Stability settings (ELF pattern)
  highConfidenceStabilityThreshold: number;  // Above this, resist drops
  maxDropPerFailure: number;          // Max confidence drop per failure
}

export const DEFAULT_CONFIG: CrossSessionConfig = {
  enabled: true,
  autoRecord: true,
  
  insightThreshold: 3,
  
  initialConfidence: 0.5,
  confidenceDecayHalfLife: 7,
  minConfidenceThreshold: 0.1,
  
  goldenRuleThreshold: 0.9,
  minValidationsForPromotion: 3,
  
  maxSessionsHistory: 100,
  maxInsightsPerProject: 1000,
  
  emaAlphaDefault: 0.25,
  emaWarmupPeriod: 5,
  
  highConfidenceStabilityThreshold: 0.8,
  maxDropPerFailure: 0.02
};

// ============================================
// CI/CD INTEGRATION
// ============================================

export interface CIResult {
  type: 'build' | 'test' | 'deploy' | 'lint';
  success: boolean;
  timestamp: Date;
  details?: string;
  affectedFiles?: string[];
  affectedInsights?: string[];
  metrics?: {
    duration?: number;
    testsRun?: number;
    testsPassed?: number;
    coverage?: number;
  };
}

// ============================================
// CONTEXT TYPES
// ============================================

export interface ProjectContext {
  guidelines: ProjectGuideline[];
  recentInsights: Insight[];
  goldenRules: HeuristicRule[];
  commonPatterns: string[];
  knownIssues: string[];
  stats: LearningStats;
}

export interface RelevantKnowledge {
  insights: Insight[];
  guidelines: ProjectGuideline[];
  heuristics: HeuristicRule[];
  score: number;
}

