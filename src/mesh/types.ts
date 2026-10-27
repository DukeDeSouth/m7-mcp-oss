/**
 * M7 Mesh — Multi-Instance Communication Types
 * @module mesh/types
 * @since v8.0
 */

// ─── Instance ────────────────────────────────────────────────────────────────

export interface MeshInstance {
  instance_id: string;
  pid: number;
  project_root: string;
  server_role?: string;
  capabilities?: string[];
  started_at: number;    // epoch ms
  last_heartbeat: number; // epoch ms
  status: 'active' | 'stale' | 'shutdown';
}

// ─── Shared Context ──────────────────────────────────────────────────────────

export type ContextType = 'working_set' | 'decision' | 'dependency' | 'summary' | 'server_role';

export interface SharedContext {
  id?: number;
  instance_id: string;
  context_type: ContextType;
  scope?: string;
  content: string;       // JSON stringified payload
  created_at: number;
  expires_at?: number;
}

// ─── Intent Protocol ─────────────────────────────────────────────────────────

export type IntentState = 'proposed' | 'acknowledged' | 'committed' | 'released' | 'conflicted';
export type IntentType = 'modify_file' | 'deploy' | 'schema_change' | 'task';

export interface MeshIntent {
  intent_id: string;
  instance_id: string;
  intent_type: IntentType;
  resource?: string;
  description: string;
  state: IntentState;
  created_at: number;
  updated_at: number;
}

// ─── Resource Locks ──────────────────────────────────────────────────────────

export interface LockInfo {
  resource_key: string;
  instance_id: string;
  pid: number;
  acquired_at: number;
  ttl_ms: number;
  purpose?: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type MeshEventType = 'joined' | 'left' | 'context_update' | 'intent' | 'conflict';

export interface MeshEvent {
  event_id?: number;
  instance_id: string;
  event_type: MeshEventType;
  payload: string;
  timestamp: number;
}

// ─── Peer Context (for Hive integration) ─────────────────────────────────────

export interface MeshPeerContext {
  instance_id: string;
  server_role?: string;
  project_root: string;
  pid: number;
  contexts: SharedContext[];
}

// ─── Signal Types ────────────────────────────────────────────────────────────

export type SignalType = 'joined' | 'left' | 'ctx' | 'intent' | 'lock';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface MeshConfig {
  meshDir: string;          // Default: ~/.m7/mesh/
  heartbeatMs: number;      // Default: 30000 (30s)
  staleCutoffMs: number;    // Default: 90000 (90s)
  signalTtlMs: number;      // Default: 60000 (60s)
  lockDefaultTtlMs: number; // Default: 30000 (30s)
}

export const DEFAULT_MESH_CONFIG: MeshConfig = {
  meshDir: '',              // Set at runtime from homedir()
  heartbeatMs: 30_000,
  staleCutoffMs: 90_000,
  signalTtlMs: 60_000,
  lockDefaultTtlMs: 30_000,
};
