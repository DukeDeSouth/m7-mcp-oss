/**
 * M7 Code Telemetry Types
 * @module telemetry/types
 */

// Semantic event types — each type represents a distinct kind of developer work
export type TelemetryEventType = 
  // Core work types
  | 'prompt_completion'    // AI prompt → generated code
  | 'error_fix'            // Error → fix pair (highest training value)
  | 'refactoring'          // Code before → after transformation
  | 'm7_session'           // M7 session lifecycle
  // v3.12: New semantic types
  | 'code_diff'            // Git diff artifact from commit
  | 'investigation'        // Discovery/research activity (analyze_task, search, etc.)
  | 'hive_coordination'    // Hive multi-agent task
  | 'feedback'             // User acceptance/rejection signal
  // CNP Event Types (Hive v3.0)
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

// Base event interface
export interface BaseTelemetryEvent {
  type: TelemetryEventType;
  timestamp: string;
  session_id?: string;    // Links events to M7 orchestration session
  episode_id?: string;    // v3.13: Groups related events into training episodes
  tool_name?: string;     // v3.13: Which M7 tool generated this event
  schema_version?: number; // v3.13: Data schema version for compatibility
}

// Prompt completion event
export interface PromptCompletionEvent extends BaseTelemetryEvent {
  type: 'prompt_completion';
  prompt: string;
  context?: {
    files?: string[];
    language?: string;
    framework?: string;
    m7_route?: string;
    m7_phase?: string;
  };
  completion: {
    code: string;
    tokens?: number;
    model?: string;
  };
  feedback?: {
    accepted?: boolean;
    edited?: boolean;
    time_to_accept?: number;
  };
}

// Error fix event
export interface ErrorFixEvent extends BaseTelemetryEvent {
  type: 'error_fix';
  error: {
    message: string;
    type: string;
    file?: string;
    line?: number;
  };
  context?: {
    code_before?: string;
    language?: string;
  };
  fix: {
    code_after: string;
    explanation?: string;
    iterations?: number;
  };
  feedback?: {
    resolved?: boolean;
    time_to_fix?: number;
  };
}

// Refactoring event
export interface RefactoringEvent extends BaseTelemetryEvent {
  type: 'refactoring';
  intent: string;
  before: {
    code: string;
    file?: string;
    lines?: number;
  };
  after: {
    code: string;
    lines?: number;
  };
  metadata?: {
    pattern?: string;
    language?: string;
    framework?: string;
  };
  feedback?: {
    accepted?: boolean;
    quality_rating?: 1 | 2 | 3 | 4 | 5;
  };
}

// M7 session event
export interface M7SessionEvent extends BaseTelemetryEvent {
  type: 'm7_session';
  session: {
    id: string;
    route: 'light' | 'medium' | 'heavy' | 'decompose';
    phases_completed: string[];
    duration_ms: number;
  };
  task: {
    description: string;
    intent?: string;
    complexity_estimated?: number;
  };
  outcome?: {
    success: boolean;
    files_changed?: number;
    iterations?: number;
    epistemic?: {
      grounded_ratio: number | null;
      frontier_shrink_rate: number | null;
      hypothesis_refutation_rate: number | null;
      grounded_steps?: number;
      total_grounding_steps?: number;
      refutation_events?: number;
      total_reflections?: number;
    };
  };
}

// CNP Event (Hive v3.0)
export interface CNPTelemetryEvent extends BaseTelemetryEvent {
  type: 'cnp_goal_received' | 'cnp_decomposition_complete' | 'cnp_task_announced' | 
        'cnp_bid_received' | 'cnp_auction_complete' | 'cnp_task_awarded' |
        'cnp_execution_started' | 'cnp_execution_complete' | 'cnp_validation_started' |
        'cnp_validation_complete' | 'cnp_task_accepted' | 'cnp_task_rejected' | 
        'cnp_synthesis_complete';
  correlationId: string;  // Goal ID for full chain tracing
  taskId: string;
  agentId?: string;
  payload: Record<string, any>;
}

// v3.12: Code diff event — Git commit artifact
export interface CodeDiffEvent extends BaseTelemetryEvent {
  type: 'code_diff';
  diff: {
    unified_diff: string;       // Unified diff (sanitized, truncated)
    files_changed: number;
    additions: number;
    deletions: number;
    languages: string[];        // Detected languages in changed files
  };
  commit?: {
    hash: string;               // Short hash (first 8 chars)
    message: string;            // Sanitized commit message
    repo_hash: string;          // Hashed repo identity (not actual remote URL)
    branch?: string;            // Branch name (sanitized)
  };
  linked_tools?: string[];      // M7 tool names used in this session before commit
}

// v3.12: Investigation event — research/discovery activity
export interface InvestigationEvent extends BaseTelemetryEvent {
  type: 'investigation';
  tool_name: string;            // Which M7 tool (analyze_task, memory_search, etc.)
  query: string;                // What was investigated (sanitized)
  result_summary: string;       // Brief outcome (truncated)
  duration_ms: number;
}

// v3.12: Hive coordination event
export interface HiveCoordinationEvent extends BaseTelemetryEvent {
  type: 'hive_coordination';
  task_summary: string;         // What was asked of the hive
  experts_count: number;        // How many experts participated
  confidence: number;           // Synthesis confidence
  duration_ms: number;
  mode: string;                 // dynamic, fixed, planned
}

// v3.12: Feedback event — user acceptance/rejection signal
export interface FeedbackEvent extends BaseTelemetryEvent {
  type: 'feedback';
  suggestion_id: string;        // Links to the original suggestion
  signal: 'accepted' | 'rejected' | 'modified' | 'reverted';
  source: 'git_commit' | 'git_revert' | 'explicit' | 'timeout' | 'implicit';
  details?: {
    time_to_action_ms?: number;
    edit_distance?: number;     // How much was modified (0 = accepted as-is)
  };
}

// Union type for all events
export type TelemetryEvent = 
  | PromptCompletionEvent 
  | ErrorFixEvent 
  | RefactoringEvent 
  | M7SessionEvent 
  | CNPTelemetryEvent
  | CodeDiffEvent
  | InvestigationEvent
  | HiveCoordinationEvent
  | FeedbackEvent;

// Batch request/response
export interface TelemetryBatchRequest {
  batch_id: string;
  device_hash: string;
  m7_version: string;
  events: TelemetryEvent[];
}

export interface TelemetryBatchResponse {
  success: boolean;
  batch_id: string;
  events_accepted: number;
  events_rejected: number;
  rejected_reasons?: Array<{ index: number; reason: string }>;
  error?: string;
}

// Tiered consent — each tier includes all lower tiers
// Tier 1: Basic stats (tool usage counts, session metadata)
// Tier 2: Prompts + completions (M7 tool inputs/outputs)
// Tier 3: Code diffs (sanitized git diffs from commits)
// Tier 4: Cross-project patterns (aggregated patterns across repos)
export type ConsentTier = 1 | 2 | 3 | 4;

// Consent
export interface TelemetryConsent {
  enabled: boolean;
  consented_at?: string;
  tier: ConsentTier;            // v3.12: Tiered consent level
  data_types: {
    prompt_completions: boolean;
    error_fixes: boolean;
    refactorings: boolean;
    m7_sessions: boolean;
    code_diffs: boolean;        // v3.12: Git diff collection
    feedback: boolean;          // v3.12: Acceptance signals
  };
}

// Stats
export interface TelemetryStats {
  global: {
    total_events: number;
    prompt_completions: number;
    error_fixes: number;
    refactorings: number;
    m7_sessions: number;
    active_contributors: number;
    events_today: number;
  };
  user?: {
    total_batches: number;
    total_events: number;
    first_event: string;
    last_event: string;
  };
}

// Configuration
export interface TelemetryConfig {
  endpoint: string;
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  maxEventSizeBytes: number;
  maxCodeLength: number;
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  // Opt-in: no default upload target. Set M7_TELEMETRY_ENDPOINT to your own collector.
  endpoint: process.env.M7_TELEMETRY_ENDPOINT ?? '',
  batchSize: 100,
  flushIntervalMs: 5 * 60 * 1000, // 5 minutes
  maxRetries: 3,
  maxEventSizeBytes: 50 * 1024, // 50KB
  maxCodeLength: 10000,
};
