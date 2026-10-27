/**
 * M7 Hive v3.0 - Contract-Net Protocol Types
 * 
 * Types for Planner/Supervisor system with auction-based task allocation.
 * 
 * @version 3.8.0
 */

// ============================================================================
// TASK STATE MACHINE
// ============================================================================

/**
 * CNP Task lifecycle states
 * 
 * Flow: CREATED → ANNOUNCED → BIDDING → AWARDED → IN_PROGRESS → SUBMITTED → VALIDATING → ACCEPTED/REJECTED
 */
export type CNPTaskState = 
  | 'CREATED'      // Initial state, not yet announced
  | 'ANNOUNCED'    // Posted to agents for bidding
  | 'BIDDING'      // Collecting bids (within timeout)
  | 'AWARDED'      // Winner selected, ready to execute
  | 'IN_PROGRESS'  // Being executed by assigned agent
  | 'SUBMITTED'    // Result submitted, pending validation
  | 'VALIDATING'   // Gatekeeper validation in progress
  | 'ACCEPTED'     // Final success state
  | 'REJECTED'     // Failed validation, may re-auction
  | 'CANCELLED';   // Aborted (manual or timeout)

/**
 * Valid state transitions
 */
export const CNP_STATE_TRANSITIONS: Record<CNPTaskState, CNPTaskState[]> = {
  'CREATED': ['ANNOUNCED', 'CANCELLED'],
  'ANNOUNCED': ['BIDDING', 'CANCELLED'],
  'BIDDING': ['AWARDED', 'ANNOUNCED', 'CANCELLED'],  // ANNOUNCED = re-auction on no bids
  'AWARDED': ['IN_PROGRESS', 'CANCELLED'],
  'IN_PROGRESS': ['SUBMITTED', 'CANCELLED'],
  'SUBMITTED': ['VALIDATING'],
  'VALIDATING': ['ACCEPTED', 'REJECTED'],
  'ACCEPTED': [],  // Terminal state
  'REJECTED': ['ANNOUNCED'],  // Re-auction with fix requirements
  'CANCELLED': []  // Terminal state
};

// ============================================================================
// CNP TASK
// ============================================================================

/**
 * Task constraints for auction and execution
 */
export interface CNPConstraints {
  /** Maximum tokens to use */
  maxTokens?: number;
  
  /** Maximum execution time in ms */
  maxTimeMs?: number;
  
  /** Required agent capabilities (skills) */
  requiredCapabilities?: string[];
  
  /** Agents to exclude from bidding */
  excludeAgents?: string[];
  
  /** Minimum quality threshold (0-1) */
  qualityThreshold?: number;
  
  /** Task-specific context to pass to agents */
  context?: Record<string, any>;
}

/**
 * CNP Task - Unit of work in the auction system
 */
export interface CNPTask {
  /** Unique task ID */
  id: string;
  
  /** Parent task ID (for subtasks) */
  parentId?: string;
  
  /** Task type */
  type: 'goal' | 'subtask' | 'review' | 'fix';
  
  /** Human-readable description */
  description: string;
  
  /** Execution constraints */
  constraints: CNPConstraints;
  
  /** IDs of tasks that must complete first */
  dependencies: string[];
  
  /** Current state in lifecycle */
  state: CNPTaskState;
  
  /** Priority (0-100, higher = more important) */
  priority: number;
  
  /** Auction deadline in ms from announce */
  auctionDeadline?: number;
  
  /** Maximum acceptable cost (tokens) */
  reservePrice?: number;
  
  /** Assigned agent ID (after award) */
  assignedAgent?: string;
  
  /** Assigned model (after award) */
  assignedModel?: string;
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Last update timestamp */
  updatedAt: string;
  
  /** Execution deadline */
  deadline?: string;
  
  /** Version for optimistic locking */
  version: number;
}

// ============================================================================
// CNP BID
// ============================================================================

/**
 * Agent's bid for a task
 */
export interface CNPBid {
  /** Unique bid ID */
  id: string;
  
  /** Task being bid on */
  taskId: string;
  
  /** Bidding agent ID */
  agentId: string;
  
  /** Agent's role name */
  agentRole: string;
  
  /** Estimated token cost */
  estimatedCost: number;
  
  /** Estimated execution time in ms */
  estimatedTime: number;
  
  /** Confidence in successful completion (0-1) */
  confidence: number;
  
  /** Brief description of approach */
  approach: string;
  
  /** Identified risks */
  risks: string[];
  
  /** Submission timestamp */
  submittedAt: string;
}

// ============================================================================
// CNP AWARD
// ============================================================================

/**
 * Score breakdown for bid evaluation
 */
export interface CNPScoreBreakdown {
  /** Cost score (lower cost = higher score) */
  cost: number;
  
  /** Time score (faster = higher score) */
  time: number;
  
  /** Confidence score (direct mapping) */
  confidence: number;
  
  /** Fairness score (penalizes consecutive wins) */
  fairness: number;
  
  /** Trust score (historical performance) */
  trust: number;
  
  /** Weighted total */
  total: number;
}

/**
 * Auction award decision
 */
export interface CNPAward {
  /** Task ID */
  taskId: string;
  
  /** Winning agent ID */
  winnerId: string;
  
  /** Winner's role name */
  winnerRole: string;
  
  /** Winning bid details */
  winningBid: CNPBid;
  
  /** Score breakdown */
  scoreBreakdown: CNPScoreBreakdown;
  
  /** Human-readable reason for selection */
  reason: string;
  
  /** Other bids considered */
  otherBids: Array<{
    agentId: string;
    score: number;
    reason: string;
  }>;
  
  /** Award timestamp */
  timestamp: string;
}

// ============================================================================
// CNP RESULT
// ============================================================================

/**
 * Task execution result
 */
export interface CNPResult {
  /** Task ID */
  taskId: string;
  
  /** Executing agent ID */
  agentId: string;
  
  /** Success status */
  success: boolean;
  
  /** Result content */
  output: string;
  
  /** Actual token usage */
  actualCost: number;
  
  /** Actual execution time in ms */
  actualTime: number;
  
  /** Artifact IDs produced (KG node IDs) */
  artifacts: string[];
  
  /** Submission timestamp */
  submittedAt: string;
  
  /** Whether result came from cache */
  cached?: boolean;
}

// ============================================================================
// CNP VALIDATION
// ============================================================================

/**
 * Validation issue from gatekeeper
 */
export interface CNPValidationIssue {
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  
  /** Issue description */
  message: string;
  
  /** Location in output (if applicable) */
  location?: string;
  
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Gatekeeper validation result
 */
export interface CNPValidation {
  /** Task ID */
  taskId: string;
  
  /** Result being validated */
  resultId: string;
  
  /** Gatekeeper type */
  gatekeeper: 'style' | 'arch' | 'security' | 'test';
  
  /** Pass/fail status */
  passed: boolean;
  
  /** Validation issues found */
  issues: CNPValidationIssue[];
  
  /** Required fixes (if failed) */
  requiredFixes?: string;
  
  /** Fix task ID (if re-auction needed) */
  fixTaskId?: string;
  
  /** Validation timestamp */
  timestamp: string;
  
  /** Validation timed out */
  timeout?: boolean;
}

// ============================================================================
// AGENT CAPABILITIES
// ============================================================================

/**
 * Agent capability for bidding
 */
export interface AgentCapability {
  /** Capability domain */
  domain: string;
  
  /** Specific skills */
  skills: string[];
  
  /** Cost multiplier (1.0 = baseline) */
  costMultiplier: number;
  
  /** Speed multiplier (1.0 = baseline) */
  speedMultiplier: number;
}

/**
 * Agent with bidding capability
 */
export interface BiddableAgent {
  /** Agent ID */
  id: string;
  
  /** Role name */
  role: string;
  
  /** Agent capabilities */
  capabilities: AgentCapability[];
  
  /** Current workload (0-1) */
  currentLoad: number;
  
  /** Historical win rate */
  winRate: number;
  
  /** Trust score from self-learning (0-1) */
  trustScore: number;
}

// ============================================================================
// SCORING WEIGHTS
// ============================================================================

/**
 * Weights for bid scoring (must sum to 1)
 */
export interface CNPScoringWeights {
  /** Weight for cost score */
  cost: number;
  
  /** Weight for time score */
  time: number;
  
  /** Weight for confidence score */
  confidence: number;
  
  /** Weight for fairness score */
  fairness: number;
  
  /** Weight for trust score */
  trust: number;
}

/**
 * Preset weights for different task types
 */
export const SCORING_WEIGHT_PRESETS: Record<string, CNPScoringWeights> = {
  default: {
    cost: 0.25,
    time: 0.20,
    confidence: 0.25,
    fairness: 0.15,
    trust: 0.15
  },
  security: {
    cost: 0.15,
    time: 0.10,
    confidence: 0.40,
    fairness: 0.15,
    trust: 0.20
  },
  coding: {
    cost: 0.25,
    time: 0.30,
    confidence: 0.25,
    fairness: 0.10,
    trust: 0.10
  },
  review: {
    cost: 0.10,
    time: 0.15,
    confidence: 0.35,
    fairness: 0.15,
    trust: 0.25
  }
};

// ============================================================================
// GATEKEEPER CONFIG
// ============================================================================

/**
 * Gatekeeper configuration
 */
export interface GatekeeperConfig {
  /** Gatekeeper type */
  type: 'style' | 'arch' | 'security' | 'test';
  
  /** Enable/disable */
  enabled: boolean;
  
  /** If true, failure blocks acceptance */
  blocking: boolean;
  
  /** Pass threshold (0-1) */
  threshold?: number;
}

// ============================================================================
// PLANNER OPTIONS
// ============================================================================

/**
 * Configuration for planner orchestrator
 */
export interface PlannerOptions {
  /** Maximum subtasks to create */
  maxSubtasks: number;
  
  /** Auction timeout in ms */
  auctionTimeoutMs: number;
  
  /** Minimum bids required to award */
  minBidsRequired: number;
  
  /** Scoring weights */
  weights: CNPScoringWeights;
  
  /** Maximum consecutive wins per agent */
  maxConsecutiveWins: number;
  
  /** Enable load balancing */
  loadBalancingEnabled: boolean;
  
  /** Gatekeeper configurations */
  gatekeepers: GatekeeperConfig[];
  
  /** Enable telemetry event logging */
  telemetryEnabled: boolean;
  
  /** Enable parallel auctions for independent tasks */
  parallelAuctions: boolean;
  
  /** Fast-track simple tasks (skip auction if 1 eligible agent) */
  fastTrackSimpleTasks: boolean;
}

/**
 * Default planner options
 */
export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  maxSubtasks: 8,
  auctionTimeoutMs: 5000,
  minBidsRequired: 1,
  weights: SCORING_WEIGHT_PRESETS.default,
  maxConsecutiveWins: 3,
  loadBalancingEnabled: true,
  gatekeepers: [
    { type: 'style', enabled: true, blocking: false },
    { type: 'arch', enabled: true, blocking: false },
    { type: 'security', enabled: false, blocking: true },
    { type: 'test', enabled: false, blocking: false }
  ],
  telemetryEnabled: true,
  parallelAuctions: true,
  fastTrackSimpleTasks: true
};

// ============================================================================
// PLANNER RESULT
// ============================================================================

/**
 * Result from planner orchestrator
 */
export interface PlannerResult {
  /** Success status */
  success: boolean;
  
  /** Goal task ID */
  goalId: string;
  
  /** Original goal description */
  goal: string;
  
  /** All tasks created */
  tasks: CNPTask[];
  
  /** All awards made */
  awards: CNPAward[];
  
  /** All results */
  results: CNPResult[];
  
  /** All validations */
  validations: CNPValidation[];
  
  /** Final synthesized output */
  synthesis: {
    content: string;
    confidence: number;
    contributingTasks: string[];
  };
  
  /** Execution metrics */
  metrics: {
    totalTokens: number;
    totalCost: number;
    totalLatencyMs: number;
    planningLatencyMs: number;
    auctionLatencyMs: number;
    executionLatencyMs: number;
    validationLatencyMs: number;
  };
  
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// TELEMETRY EVENTS
// ============================================================================

/**
 * CNP telemetry event types
 */
export type CNPEventType = 
  | 'cnp_goal_received'
  | 'cnp_decomposition_complete'
  | 'cnp_task_announced'
  | 'cnp_bid_received'
  | 'cnp_auction_complete'
  | 'cnp_task_awarded'
  | 'cnp_execution_started'
  | 'cnp_execution_complete'
  | 'cnp_validation_started'
  | 'cnp_validation_complete'
  | 'cnp_task_accepted'
  | 'cnp_task_rejected'
  | 'cnp_synthesis_complete';

/**
 * CNP telemetry event
 */
export interface CNPTelemetryEvent {
  /** Event type */
  type: CNPEventType;
  
  /** Correlation ID (goal ID for full chain) */
  correlationId: string;
  
  /** Task ID */
  taskId: string;
  
  /** Agent ID (if applicable) */
  agentId?: string;
  
  /** Event timestamp */
  timestamp: string;
  
  /** Event-specific payload */
  payload: Record<string, any>;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validate state transition
 */
export function isValidTransition(from: CNPTaskState, to: CNPTaskState): boolean {
  return CNP_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get scoring weights for task type
 */
export function getWeightsForTaskType(taskType: string): CNPScoringWeights {
  return SCORING_WEIGHT_PRESETS[taskType] || SCORING_WEIGHT_PRESETS.default;
}

/**
 * Create a new CNP task
 */
export function createCNPTask(
  description: string,
  type: CNPTask['type'] = 'subtask',
  options: Partial<CNPTask> = {}
): CNPTask {
  const now = new Date().toISOString();
  
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    description,
    constraints: {},
    dependencies: [],
    state: 'CREATED',
    priority: 50,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...options
  };
}
