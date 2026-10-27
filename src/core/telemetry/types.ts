/**
 * M7 Hook Telemetry Types
 * 
 * Types for behavioral telemetry collected via Cursor Hooks.
 * These events are written by .cursor/hooks/m7-telemetry.mjs
 * and read by the MCP Server's HookTelemetryIngester.
 * 
 * @module core/telemetry/types
 * @since v7.0
 */

// ─── Event Types ─────────────────────────────────────────────

export type TelemetryEventType =
  | 'session_start' | 'session_end'
  | 'tool_start' | 'tool_end' | 'tool_error'
  | 'file_edit'
  | 'shell_exec'
  | 'thinking'
  | 'agent_response'
  | 'prompt_submit'
  | 'subagent_start' | 'subagent_stop'
  | 'compact'
  | 'stop';

export interface TelemetryEvent {
  /** ISO 8601 timestamp */
  ts: string;
  /** Normalized event type */
  event: TelemetryEventType;
  /** Stable across turns within a session */
  conversation_id?: string;
  /** Changes per user message */
  generation_id?: string;
  /** AI model used */
  model?: string;
  /** Workspace root path */
  workspace?: string;

  // Tool events
  /** Tool name, e.g. "Read", "Shell", "Write" */
  tool_name?: string;
  /** Bytes of tool input */
  tool_input_size?: number;
  /** Bytes of tool output */
  tool_output_size?: number;
  /** Execution time in ms */
  duration_ms?: number;

  // File events
  /** SHA-256 of file path (truncated, not content) */
  file_hash?: string;
  /** Number of edits in this event */
  edit_count?: number;
  /** Lines added */
  added_lines?: number;
  /** Lines removed */
  removed_lines?: number;

  // Shell events
  /** Hash of full command (structural level) */
  command_hash?: string;
  /** First word of command (behavioral level) */
  command_name?: string;
  /** Command exit code */
  exit_code?: number;

  // Thinking events
  /** How long AI thought (ms) */
  thinking_duration_ms?: number;
  /** Length of thinking text (chars) */
  thinking_length?: number;

  // Session events
  /** "completed" | "aborted" | "error" */
  status?: string;

  // Error events
  /** "timeout" | "error" | "permission_denied" */
  error_type?: string;
  /** Hash of error message */
  error_message_hash?: string;
}

// ─── Freestyle Detection ─────────────────────────────────────

export type FreestyleRisk = 'low' | 'medium' | 'high';

export interface FreestyleSignals {
  /** >50 lines added without prior Read tool */
  code_volume_spike: boolean;
  /** File edits without thinking events */
  hypothesis_absence: boolean;
  /** First edit < 30s after session start */
  convergence_velocity: boolean;
  /** Many lines added, near-zero removed */
  backtrack_absence: boolean;
  /** No Read/Grep/Search in recent events */
  tool_avoidance: boolean;
}

export interface FreestyleResult {
  risk: FreestyleRisk;
  signals: FreestyleSignals;
  activeSignalCount: number;
  hint: string;
}

// ─── DISCOVERY Tracking ──────────────────────────────────────

export type DiscoveryPhase =
  | 'E0_none'
  | 'E1_restatement'
  | 'E2_proposal'
  | 'E3_uncertainty'
  | 'E4_revision';

export interface DiscoveryState {
  phase: DiscoveryPhase;
  /** E1→E2 happened too fast, or E2 without reads */
  collapsed: boolean;
  e1_ts?: string;
  e2_ts?: string;
  e3_ts?: string;
  e4_ts?: string;
  /** Milliseconds from E1 to E2 */
  time_e1_to_e2_ms?: number;
}

// ─── Telemetry Snapshot ──────────────────────────────────────

export interface TelemetrySnapshot {
  session_duration_s: number;
  event_count: number;
  tool_calls: Record<string, number>;
  file_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
  thinking_total_ms: number;
  thinking_count: number;
  shell_commands: number;
  last_event_ts: string;
  events: TelemetryEvent[];
}

// ─── Privacy Config ──────────────────────────────────────────

export interface TelemetryConfig {
  level: 'structural' | 'behavioral' | 'full';
  retention_days: number;
  max_file_size_mb: number;
  excluded_paths: string[];
  capture: {
    thinking_text: boolean;
    tool_content: boolean;
    file_diffs: boolean;
    shell_output: boolean;
    prompt_text: boolean;
    file_paths: boolean;
    command_text: boolean;
  };
}

// ─── Enrichment (added to MCP tool responses) ────────────────

export interface TelemetryEnrichment {
  freestyle_risk: FreestyleRisk;
  freestyle_signals: FreestyleSignals;
  freestyle_hint: string;
  discovery_phase: DiscoveryPhase;
  discovery_collapsed: boolean;
  session_duration_s: number;
  tool_calls_count: number;
  file_edits: number;
  lines_changed: number;
  thinking_time_s: number;
}

// ─── Default Config ──────────────────────────────────────────

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  level: 'structural',
  retention_days: 7,
  max_file_size_mb: 10,
  excluded_paths: [],
  capture: {
    thinking_text: false,
    tool_content: false,
    file_diffs: false,
    shell_output: false,
    prompt_text: false,
    file_paths: false,
    command_text: false,
  },
};
