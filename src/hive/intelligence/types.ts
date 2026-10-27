/**
 * M7 Hive v2.0 - Dynamic Intelligence Types
 * 
 * Types for dynamic agent generation and model selection
 * @version 3.7.0
 */

// ============================================================================
// DYNAMIC AGENT TYPES
// ============================================================================

/**
 * Domain categories for model specialization
 * Based on LiveBench benchmark categories
 */
export type AgentDomain = 
  | 'reasoning'      // Complex analysis, logic
  | 'coding'         // Code generation, debugging
  | 'math'           // Mathematical calculations
  | 'data'           // Data analysis
  | 'language'       // Natural language tasks
  | 'security'       // Security analysis (custom)
  | 'architecture'   // System design (custom)
  | 'general';       // General purpose

/**
 * Dynamically generated agent configuration
 */
export interface DynamicAgent {
  /** Unique ID for this execution */
  id: string;
  
  /** Human-readable role name (e.g., "Fintech API Architect") */
  role: string;
  
  /** Area of expertise */
  expertise: string;
  
  /** Specific focus for this task */
  focus: string;
  
  /** Unique perspective this agent brings */
  perspective: string;
  
  /** Primary domain for model selection */
  domain: AgentDomain;
  
  /** Optional secondary domains */
  secondaryDomains?: AgentDomain[];
}

/**
 * Response from Hive Architect
 */
export interface ArchitectResponse {
  /** Generated team of agents */
  agents: DynamicAgent[];
  
  /** Reasoning for team composition */
  reasoning: string;
  
  /** Estimated complexity */
  complexity: 'simple' | 'medium' | 'complex' | 'expert';
  
  /** Suggested execution mode */
  executionMode: 'parallel' | 'sequential' | 'debate';
}

// ============================================================================
// MODEL SELECTION TYPES
// ============================================================================

/**
 * Model benchmark scores by category
 */
export interface ModelScores {
  global: number;
  reasoning: number;
  coding: number;
  math: number;
  data: number;
  language: number;
  // Extended scores (not from LiveBench, estimated)
  security?: number;
  architecture?: number;
}

/**
 * Model benchmark entry
 */
export interface ModelBenchmark {
  /** Model identifier */
  model: string;
  
  /** Provider */
  provider: 'openai' | 'anthropic';
  
  /** Model tier */
  tier: 'flagship' | 'standard' | 'economy' | 'specialized';
  
  /** Benchmark scores */
  scores: ModelScores;
  
  /** API model name (may differ from display name) */
  apiName?: string;
}

/**
 * Result of model selection
 */
export interface ModelSelection {
  /** Selected model */
  model: string;
  
  /** Provider */
  provider: 'openai' | 'anthropic';
  
  /** Score for the selected domain */
  score: number;
  
  /** Reasoning for selection */
  reasoning: string;
  
  /** Alternative models considered */
  alternatives?: Array<{ model: string; score: number }>;
}

// ============================================================================
// SELF-LEARNING TYPES
// ============================================================================

/**
 * Execution log entry for self-learning
 */
export interface ExecutionLog {
  /** Unique execution ID */
  id: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Original task description */
  task: string;
  
  /** Dynamic agent configuration */
  agent: DynamicAgent;
  
  /** Model used */
  model: string;
  
  /** Provider */
  provider: 'openai' | 'anthropic';
  
  /** Response content (truncated for storage) */
  responsePreview: string;
  
  /** Token usage */
  tokensUsed: number;
  
  /** Response latency in ms */
  latencyMs: number;
  
  /** Was this response used in final synthesis? */
  wasUsedInFinal: boolean;
  
  /** User rating (if provided) */
  userRating?: number;
  
  /** Auto-calculated quality score */
  qualityScore?: number;
}

/**
 * Learning adjustments for a model in a domain
 */
export interface LearningAdjustment {
  model: string;
  domain: AgentDomain;
  
  /** Score adjustment (-1 to +1) */
  adjustment: number;
  
  /** Number of samples this is based on */
  sampleCount: number;
  
  /** Last updated */
  lastUpdated: string;
}

/**
 * Self-learning state
 */
export interface LearningState {
  /** Version of learning data format */
  version: string;
  
  /** Total executions logged */
  totalExecutions: number;
  
  /** Model adjustments */
  adjustments: LearningAdjustment[];
  
  /** Last updated */
  lastUpdated: string;
}

// ============================================================================
// DYNAMIC AGENT PROPOSAL TYPES
// ============================================================================

/**
 * Proposal from a dynamic agent
 */
export interface DynamicAgentProposal {
  /** Agent that generated this */
  agent: DynamicAgent;
  
  /** Model used */
  model: string;
  
  /** Provider */
  provider: 'openai' | 'anthropic';
  
  /** Main proposal content */
  proposal: string;
  
  /** Reasoning behind the proposal */
  reasoning: string;
  
  /** Confidence level (0-1) */
  confidence: number;
  
  /** Implementation steps */
  implementationSteps: string[];
  
  /** Requirements */
  requirements: string[];
  
  /** Key assumptions behind the proposal */
  keyAssumptions?: string[];
  
  /** What evidence would change the agent's mind */
  whatWouldChangeMyMind?: string;
  
  /** Identified risks */
  risks: string[];
  
  /** Alternative approaches */
  alternatives: string[];
  
  /** Estimated time */
  estimatedTime?: string;
  
  /** Execution metrics */
  metrics: {
    tokensUsed: number;
    latencyMs: number;
    costEstimate: number;
  };
}

/**
 * Result from Dynamic Hive execution
 */
export interface DynamicHiveResult {
  /** Success status */
  success: boolean;
  
  /** Task ID */
  taskId: string;
  
  /** Original task */
  task: string;
  
  /** Team created by Architect */
  team: DynamicAgent[];
  
  /** All proposals from agents */
  proposals: DynamicAgentProposal[];
  
  /** Synthesized final solution */
  synthesis: {
    content: string;
    confidence: number;
    contributingAgents: string[];
  };
  
  /** Debate results (v7.0 — real LLM-powered debates) */
  debate?: {
    rounds: any[];
    finalProposals: DynamicAgentProposal[];
    converged: boolean;
    convergenceScore: number;
    totalRounds: number;
    totalCost: number;
    totalTokens: number;
    totalLatencyMs: number;
    stoppedReason: 'converged' | 'max_rounds' | 'budget_cap';
  };
  
  /** Execution metrics */
  metrics: {
    totalTokens: number;
    totalCost: number;
    totalLatencyMs: number;
    architectLatencyMs: number;
    synthesisLatencyMs: number;
    /** Debate latency in ms (v7.0) */
    debateLatencyMs?: number;
    /** Debate cost in USD (v7.0) */
    debateCost?: number;
    /** Number of debate rounds (v7.0) */
    debateRounds?: number;
  };
  
  /** Recommendations */
  recommendations: string[];
  
  /** Error if failed */
  error?: string;
}

// ============================================================================
// BENCHMARK DATA TYPES
// ============================================================================

/**
 * LiveBench baseline data structure
 */
export interface BenchmarkBaseline {
  /** Version of LiveBench data */
  version: string;
  
  /** Source URL */
  source: string;
  
  /** Last updated */
  lastUpdated: string;
  
  /** Model benchmarks */
  models: ModelBenchmark[];
}
