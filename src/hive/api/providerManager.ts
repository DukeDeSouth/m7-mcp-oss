/**
 * M7 v3.10 Provider Manager
 * 
 * Manages provider state, cooldowns, and automatic failover.
 * Implements Circuit Breaker pattern for resilient API access.
 * 
 * Features:
 * - Provider health tracking
 * - Automatic cooldown on rate limits
 * - Failover to alternate providers
 * - Recovery detection
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

import { createLogger } from '../../core/utils/logger.js';
import {
  ProviderId,
  ProviderState,
  ProviderStatus,
  ProviderHealthMetrics,
  FailureReason,
  CooldownConfig,
  FailoverConfig,
  ProviderEvent,
  IProviderManager,
  DEFAULT_COOLDOWN_CONFIG,
  DEFAULT_FAILOVER_CONFIG,
} from '../types/provider.js';
import { classifyError } from '../../core/utils/retry.js';

const log = createLogger('[ProviderManager]');

// ============================================
// PROVIDER MANAGER CLASS
// ============================================

export class ProviderManager implements IProviderManager {
  private statuses: Map<ProviderId, ProviderStatus> = new Map();
  private cooldownConfig: CooldownConfig;
  private failoverConfig: FailoverConfig;
  private eventLog: ProviderEvent[] = [];
  private latencyWindow: Map<ProviderId, number[]> = new Map();
  
  private readonly LATENCY_WINDOW_SIZE = 20;
  private readonly MAX_EVENT_LOG = 100;

  constructor(
    cooldownConfig: Partial<CooldownConfig> = {},
    failoverConfig: Partial<FailoverConfig> = {}
  ) {
    this.cooldownConfig = { ...DEFAULT_COOLDOWN_CONFIG, ...cooldownConfig };
    this.failoverConfig = { ...DEFAULT_FAILOVER_CONFIG, ...failoverConfig };
    
    // Initialize provider statuses
    this.initializeProvider('openai');
    this.initializeProvider('anthropic');
    
    log.info('ProviderManager initialized with failover enabled:', this.failoverConfig.enabled);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  private initializeProvider(provider: ProviderId): void {
    this.statuses.set(provider, {
      provider,
      state: 'healthy',
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
      avgLatencyMs: 0,
    });
    this.latencyWindow.set(provider, []);
  }

  // ============================================
  // STATUS METHODS
  // ============================================

  getStatus(provider: ProviderId): ProviderStatus {
    const status = this.statuses.get(provider);
    if (!status) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    
    // Check if cooldown has expired
    if (status.state === 'cooldown' && status.cooldownUntil) {
      if (Date.now() >= status.cooldownUntil) {
        this.exitCooldown(provider);
      }
    }
    
    // Check for auto-recovery from failed state
    if (status.state === 'failed' && status.lastFailure) {
      const timeSinceFailure = Date.now() - status.lastFailure;
      if (timeSinceFailure >= this.cooldownConfig.autoRecoverMs) {
        this.attemptRecovery(provider);
      }
    }
    
    return { ...status };
  }

  getAllStatuses(): Record<ProviderId, ProviderStatus> {
    return {
      openai: this.getStatus('openai'),
      anthropic: this.getStatus('anthropic'),
    };
  }

  // ============================================
  // REQUEST TRACKING
  // ============================================

  recordSuccess(provider: ProviderId, latencyMs: number): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    // Update status
    status.totalRequests++;
    status.lastSuccess = Date.now();
    status.consecutiveFailures = 0;
    
    // Update latency tracking
    this.updateLatency(provider, latencyMs);
    
    // If was degraded/cooldown, check for recovery
    if (status.state !== 'healthy') {
      this.attemptRecovery(provider);
    }
  }

  recordFailure(provider: ProviderId, reason: FailureReason, error?: string): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    const previousState = status.state;
    
    // Update status
    status.totalRequests++;
    status.totalFailures++;
    status.consecutiveFailures++;
    status.lastFailure = Date.now();
    status.failureReason = reason;
    status.lastError = error;
    
    log.warn(
      `Provider ${provider} failure #${status.consecutiveFailures}: ` +
      `[${reason}] ${error || 'No details'}`
    );
    
    // Determine new state
    if (status.consecutiveFailures >= this.cooldownConfig.failuresBeforeFailed) {
      this.enterFailedState(provider, reason);
    } else if (status.consecutiveFailures >= this.cooldownConfig.failuresBeforeCooldown) {
      this.enterCooldown(provider, reason);
    } else if (status.state === 'healthy') {
      this.transitionState(provider, 'degraded', `Failure: ${reason}`);
    }
  }

  /**
   * Record failure from an error object (auto-classifies)
   */
  recordFailureFromError(provider: ProviderId, error: unknown): void {
    const classified = classifyError(error);
    const reason = this.mapErrorCodeToReason(classified.code);
    this.recordFailure(provider, reason, classified.message);
  }

  private mapErrorCodeToReason(code: string): FailureReason {
    switch (code) {
      case 'RATE_LIMIT':
      case 'TOO_MANY_REQUESTS':
        return 'rate_limit';
      case 'TIMEOUT':
      case 'GATEWAY_TIMEOUT':
        return 'timeout';
      case 'AUTHENTICATION':
      case 'INVALID_API_KEY':
        return 'auth';
      case 'BILLING':
        return 'billing';
      case 'SERVICE_UNAVAILABLE':
      case 'INTERNAL_ERROR':
        return 'service_error';
      case 'NETWORK_ERROR':
      case 'CONNECTION_RESET':
        return 'network';
      default:
        return 'unknown';
    }
  }

  // ============================================
  // STATE TRANSITIONS
  // ============================================

  private transitionState(provider: ProviderId, newState: ProviderState, reason: string): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    const previousState = status.state;
    if (previousState === newState) return;

    status.state = newState;
    
    this.logEvent({
      type: 'state_change',
      provider,
      timestamp: Date.now(),
      previousState,
      newState,
      reason,
    });

    log.info(`Provider ${provider}: ${previousState} → ${newState} (${reason})`);
  }

  private enterCooldown(provider: ProviderId, reason: FailureReason): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    // Calculate cooldown duration with exponential backoff
    const multiplier = Math.pow(
      this.cooldownConfig.cooldownMultiplier,
      Math.max(0, status.consecutiveFailures - this.cooldownConfig.failuresBeforeCooldown)
    );
    const cooldownMs = Math.min(
      this.cooldownConfig.baseCooldownMs * multiplier,
      this.cooldownConfig.maxCooldownMs
    );

    status.state = 'cooldown';
    status.cooldownUntil = Date.now() + cooldownMs;
    status.failureReason = reason;

    this.logEvent({
      type: 'cooldown_start',
      provider,
      timestamp: Date.now(),
      reason: reason,
      details: { 
        durationMs: cooldownMs,
        consecutiveFailures: status.consecutiveFailures,
      },
    });

    log.warn(
      `Provider ${provider} entering cooldown for ${Math.round(cooldownMs / 1000)}s ` +
      `(${status.consecutiveFailures} consecutive failures, reason: ${reason})`
    );
  }

  private exitCooldown(provider: ProviderId): void {
    const status = this.statuses.get(provider);
    if (!status || status.state !== 'cooldown') return;

    status.state = 'degraded'; // Go to degraded, not healthy
    status.cooldownUntil = undefined;

    this.logEvent({
      type: 'cooldown_end',
      provider,
      timestamp: Date.now(),
    });

    log.info(`Provider ${provider} exiting cooldown (state: degraded)`);
  }

  private enterFailedState(provider: ProviderId, reason: FailureReason): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    status.state = 'failed';
    status.failureReason = reason;

    this.logEvent({
      type: 'state_change',
      provider,
      timestamp: Date.now(),
      previousState: status.state,
      newState: 'failed',
      reason: `${status.consecutiveFailures} consecutive failures`,
    });

    log.error(
      `Provider ${provider} marked as FAILED after ${status.consecutiveFailures} failures. ` +
      `Will auto-recover in ${this.cooldownConfig.autoRecoverMs / 1000}s`
    );
  }

  private attemptRecovery(provider: ProviderId): void {
    const status = this.statuses.get(provider);
    if (!status) return;

    const previousState = status.state;
    status.state = 'healthy';
    status.consecutiveFailures = 0;
    status.failureReason = undefined;
    status.cooldownUntil = undefined;

    this.logEvent({
      type: 'recovery',
      provider,
      timestamp: Date.now(),
      previousState,
      newState: 'healthy',
    });

    log.info(`Provider ${provider} recovered: ${previousState} → healthy`);
  }

  // ============================================
  // AVAILABILITY & FAILOVER
  // ============================================

  isAvailable(provider: ProviderId): boolean {
    const status = this.getStatus(provider);
    return status.state === 'healthy' || status.state === 'degraded';
  }

  getBestProvider(): ProviderId | null {
    // Try providers in preferred order
    for (const provider of this.failoverConfig.preferredOrder) {
      if (this.isAvailable(provider)) {
        return provider;
      }
    }
    
    // No healthy provider available
    log.error('No healthy provider available!');
    return null;
  }

  getFallback(provider: ProviderId): ProviderId | null {
    if (!this.failoverConfig.enabled) {
      return null;
    }

    const fallback = this.failoverConfig.fallbackMap[provider];
    if (fallback && this.isAvailable(fallback)) {
      this.logEvent({
        type: 'failover',
        provider,
        timestamp: Date.now(),
        details: { fallbackTo: fallback },
      });

      if (this.failoverConfig.logFailovers) {
        log.warn(`Failover: ${provider} → ${fallback}`);
      }

      return fallback;
    }

    return null;
  }

  /**
   * Get a provider for a request, with automatic fallback
   */
  getProviderForRequest(preferred?: ProviderId): ProviderId | null {
    // If preferred is specified and available, use it
    if (preferred && this.isAvailable(preferred)) {
      return preferred;
    }

    // If preferred is specified but unavailable, try fallback
    if (preferred) {
      const fallback = this.getFallback(preferred);
      if (fallback) {
        return fallback;
      }
    }

    // Otherwise, get best available
    return this.getBestProvider();
  }

  // ============================================
  // HEALTH METRICS
  // ============================================

  getHealthMetrics(provider: ProviderId): ProviderHealthMetrics {
    const status = this.getStatus(provider);
    const latencies = this.latencyWindow.get(provider) || [];
    
    const successRate = status.totalRequests > 0
      ? (status.totalRequests - status.totalFailures) / status.totalRequests
      : 1;
    
    const avgResponseTime = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    
    const timeSinceLastSuccess = status.lastSuccess
      ? Date.now() - status.lastSuccess
      : undefined;
    
    const isUsable = this.isAvailable(provider);
    
    // Health score: weighted combination of factors
    let healthScore = 100;
    healthScore -= (1 - successRate) * 40;  // Up to -40 for failures
    healthScore -= Math.min(status.consecutiveFailures * 10, 30);  // Up to -30 for consecutive failures
    if (status.state === 'degraded') healthScore -= 10;
    if (status.state === 'cooldown') healthScore -= 30;
    if (status.state === 'failed') healthScore -= 50;
    healthScore = Math.max(0, Math.min(100, healthScore));
    
    return {
      successRate,
      avgResponseTime,
      sampleSize: status.totalRequests,
      timeSinceLastSuccess,
      isUsable,
      healthScore,
    };
  }

  // ============================================
  // MANAGEMENT
  // ============================================

  resetProvider(provider: ProviderId): void {
    this.initializeProvider(provider);
    log.info(`Provider ${provider} reset to healthy state`);
  }

  resetAll(): void {
    this.resetProvider('openai');
    this.resetProvider('anthropic');
    log.info('All providers reset');
  }

  // ============================================
  // HELPERS
  // ============================================

  private updateLatency(provider: ProviderId, latencyMs: number): void {
    const latencies = this.latencyWindow.get(provider) || [];
    latencies.push(latencyMs);
    
    // Keep only recent samples
    if (latencies.length > this.LATENCY_WINDOW_SIZE) {
      latencies.shift();
    }
    
    this.latencyWindow.set(provider, latencies);
    
    // Update average in status
    const status = this.statuses.get(provider);
    if (status) {
      status.avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    }
  }

  private logEvent(event: ProviderEvent): void {
    this.eventLog.push(event);
    
    // Keep log bounded
    if (this.eventLog.length > this.MAX_EVENT_LOG) {
      this.eventLog = this.eventLog.slice(-this.MAX_EVENT_LOG);
    }
  }

  getEventLog(): ProviderEvent[] {
    return [...this.eventLog];
  }

  getRecentEvents(count: number = 10): ProviderEvent[] {
    return this.eventLog.slice(-count);
  }

  // ============================================
  // SUMMARY
  // ============================================

  getSummary(): string {
    const openai = this.getStatus('openai');
    const anthropic = this.getStatus('anthropic');
    const openaiHealth = this.getHealthMetrics('openai');
    const anthropicHealth = this.getHealthMetrics('anthropic');

    return [
      'Provider Status Summary:',
      `  OpenAI: ${openai.state} (health: ${openaiHealth.healthScore}%, ` +
        `success: ${(openaiHealth.successRate * 100).toFixed(1)}%)`,
      `  Anthropic: ${anthropic.state} (health: ${anthropicHealth.healthScore}%, ` +
        `success: ${(anthropicHealth.successRate * 100).toFixed(1)}%)`,
      `  Best provider: ${this.getBestProvider() || 'NONE'}`,
    ].join('\n');
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!instance) {
    instance = new ProviderManager();
  }
  return instance;
}

export function resetProviderManager(): void {
  instance = null;
}

export default ProviderManager;
