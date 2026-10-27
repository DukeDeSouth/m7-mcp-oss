/**
 * M7 v3.10 Provider Types
 * 
 * Types for provider state tracking and failover management.
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

// ============================================
// PROVIDER IDENTIFICATION
// ============================================

export type ProviderId = 'openai' | 'anthropic';

// ============================================
// PROVIDER STATE
// ============================================

export type ProviderState = 
  | 'healthy'      // Provider is working normally
  | 'degraded'     // Experiencing issues but still usable
  | 'cooldown'     // Temporarily unavailable (rate limited, etc.)
  | 'failed';      // Multiple failures, needs manual intervention

export type FailureReason =
  | 'rate_limit'      // 429 Too Many Requests
  | 'timeout'         // Request timed out
  | 'auth'            // Authentication failed
  | 'billing'         // Payment/quota issues
  | 'service_error'   // 5xx errors
  | 'network'         // Network connectivity issues
  | 'unknown';        // Unknown error

// ============================================
// PROVIDER STATUS
// ============================================

export interface ProviderStatus {
  /** Provider identifier */
  provider: ProviderId;
  
  /** Current state */
  state: ProviderState;
  
  /** Timestamp when cooldown ends (if in cooldown) */
  cooldownUntil?: number;
  
  /** Reason for current state (if not healthy) */
  failureReason?: FailureReason;
  
  /** Number of consecutive failures */
  consecutiveFailures: number;
  
  /** Last error message */
  lastError?: string;
  
  /** Last successful request timestamp */
  lastSuccess?: number;
  
  /** Last failure timestamp */
  lastFailure?: number;
  
  /** Total requests since startup */
  totalRequests: number;
  
  /** Total failures since startup */
  totalFailures: number;
  
  /** Average latency in ms (rolling window) */
  avgLatencyMs: number;
}

// ============================================
// PROVIDER HEALTH METRICS
// ============================================

export interface ProviderHealthMetrics {
  /** Success rate (0-1) over recent window */
  successRate: number;
  
  /** Average response time in ms */
  avgResponseTime: number;
  
  /** Number of requests in measurement window */
  sampleSize: number;
  
  /** Time since last successful request */
  timeSinceLastSuccess?: number;
  
  /** Is provider currently usable */
  isUsable: boolean;
  
  /** Health score (0-100) */
  healthScore: number;
}

// ============================================
// COOLDOWN CONFIGURATION
// ============================================

export interface CooldownConfig {
  /** Base cooldown duration in ms (default: 60000 = 1 minute) */
  baseCooldownMs: number;
  
  /** Maximum cooldown duration in ms (default: 300000 = 5 minutes) */
  maxCooldownMs: number;
  
  /** Multiplier for consecutive failures (default: 1.5) */
  cooldownMultiplier: number;
  
  /** Number of failures before entering cooldown (default: 2) */
  failuresBeforeCooldown: number;
  
  /** Number of failures before marking as failed (default: 5) */
  failuresBeforeFailed: number;
  
  /** Time window for counting failures in ms (default: 300000 = 5 minutes) */
  failureWindowMs: number;
  
  /** Auto-recover from failed state after this time (default: 600000 = 10 minutes) */
  autoRecoverMs: number;
}

export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  baseCooldownMs: 60000,        // 1 minute
  maxCooldownMs: 300000,        // 5 minutes
  cooldownMultiplier: 1.5,
  failuresBeforeCooldown: 2,
  failuresBeforeFailed: 5,
  failureWindowMs: 300000,      // 5 minutes
  autoRecoverMs: 600000,        // 10 minutes
};

// ============================================
// FAILOVER CONFIGURATION
// ============================================

export interface FailoverConfig {
  /** Enable automatic failover to alternate provider */
  enabled: boolean;
  
  /** Preferred provider order */
  preferredOrder: ProviderId[];
  
  /** Fallback mappings: which provider to use when primary fails */
  fallbackMap: Record<ProviderId, ProviderId>;
  
  /** Maximum failover attempts per request */
  maxFailoverAttempts: number;
  
  /** Log failover events */
  logFailovers: boolean;
}

export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  enabled: true,
  preferredOrder: ['anthropic', 'openai'],
  fallbackMap: {
    openai: 'anthropic',
    anthropic: 'openai',
  },
  maxFailoverAttempts: 1,
  logFailovers: true,
};

// ============================================
// PROVIDER MANAGER INTERFACE
// ============================================

export interface IProviderManager {
  /** Get current status of a provider */
  getStatus(provider: ProviderId): ProviderStatus;
  
  /** Get status of all providers */
  getAllStatuses(): Record<ProviderId, ProviderStatus>;
  
  /** Record a successful request */
  recordSuccess(provider: ProviderId, latencyMs: number): void;
  
  /** Record a failed request */
  recordFailure(provider: ProviderId, reason: FailureReason, error?: string): void;
  
  /** Check if provider is available */
  isAvailable(provider: ProviderId): boolean;
  
  /** Get best available provider */
  getBestProvider(): ProviderId | null;
  
  /** Get fallback provider for a failed provider */
  getFallback(provider: ProviderId): ProviderId | null;
  
  /** Force reset a provider's status */
  resetProvider(provider: ProviderId): void;
  
  /** Get health metrics for a provider */
  getHealthMetrics(provider: ProviderId): ProviderHealthMetrics;
}

// ============================================
// EVENTS
// ============================================

export type ProviderEventType =
  | 'state_change'
  | 'cooldown_start'
  | 'cooldown_end'
  | 'failover'
  | 'recovery';

export interface ProviderEvent {
  type: ProviderEventType;
  provider: ProviderId;
  timestamp: number;
  previousState?: ProviderState;
  newState?: ProviderState;
  reason?: string;
  details?: Record<string, unknown>;
}
