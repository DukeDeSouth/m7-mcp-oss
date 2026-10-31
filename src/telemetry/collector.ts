import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[Telemetry]');
/**
 * M7 Telemetry Collector
 * Collects, batches, and sends telemetry events to the server
 * @module telemetry/collector
 */

import { createHash, randomUUID } from 'crypto';
import { hostname, platform, arch, cpus } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PACKAGE_VERSION } from '../core/utils/packageVersion.js';
import {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryBatchRequest,
  TelemetryBatchResponse,
  TelemetryConsent,
  ConsentTier,
  TelemetryConfig,
  TelemetryStats,
  DEFAULT_TELEMETRY_CONFIG,
  CodeDiffEvent,
  InvestigationEvent,
  HiveCoordinationEvent,
  FeedbackEvent,
  ErrorFixEvent,
  M7SessionEvent,
  RefactoringEvent,
} from './types.js';
import { sanitizeBatch } from './sanitizer.js';

// Tool name → semantic event type mapping
const TOOL_TYPE_MAP: Record<string, TelemetryEventType> = {
  // Investigation tools
  'mcp_m7_analyze_task': 'investigation',
  'mcp_m7_memory': 'investigation',
  'mcp_m7_check_errors': 'investigation',
  'mcp_m7_scope': 'investigation',
  'mcp_m7_schema': 'investigation',
  'mcp_m7_knowledge_graph': 'investigation',
  'mcp_m7_arch_advisor': 'investigation',
  'mcp_m7_project_index': 'investigation',
  'mcp_m7_warmup': 'investigation',
  // Hive tools
  'mcp_m7_hive_coordinator': 'hive_coordination',
  // Session tools
  'mcp_m7_session': 'm7_session',
  'mcp_m7_cycle': 'm7_session',
  // Validation tools
  'mcp_m7_validate': 'prompt_completion',
  'mcp_m7_validate_implementation': 'prompt_completion',
  // Style/quality tools
  'mcp_m7_style_guardian': 'prompt_completion',
  'mcp_m7_error_database': 'error_fix',
  // Code change tools → refactoring
  'mcp_m7_impact': 'refactoring',
  'mcp_m7_cross_session': 'refactoring',
  // Default: prompt_completion
};

/**
 * Classify a tool call into the correct semantic event type
 */
export function classifyToolEvent(toolName: string): TelemetryEventType {
  return TOOL_TYPE_MAP[toolName] || 'prompt_completion';
}

// M7 config directory
const M7_DIR = join(homedir(), '.m7');
const CONFIG_FILE = join(M7_DIR, 'telemetry_config.json');

export class TelemetryCollector {
  private buffer: TelemetryEvent[] = [];
  private config: TelemetryConfig;
  private consent: TelemetryConsent;
  private deviceHash: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private m7Version: string;
  
  // v3.12: Session tracking for linking events
  private activeSessionId: string | null = null;
  private sessionToolCalls: string[] = [];
  
  // v3.13: Episode tracking for grouping events into training trajectories
  private activeEpisodeId: string | null = null;
  private episodeEventCount: number = 0;
  private static readonly SCHEMA_VERSION = 2;

  /**
   * Remote upload is opt-in: it only happens when an endpoint is configured
   * (M7_TELEMETRY_ENDPOINT env var or explicit config). Without it, telemetry
   * is local-only and nothing leaves the machine.
   */
  private get remoteEnabled(): boolean {
    return Boolean(this.config.endpoint && this.config.endpoint.trim().length > 0);
  }

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.deviceHash = this.generateDeviceHash();
    this.m7Version = PACKAGE_VERSION;
    this.consent = this.loadConsent();
    
    // Ensure M7 directory exists
    if (!existsSync(M7_DIR)) {
      mkdirSync(M7_DIR, { recursive: true });
    }
    
    // Start flush timer if enabled
    if (this.consent.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Generate a unique device identifier (hashed for privacy)
   */
  private generateDeviceHash(): string {
    try {
      const data = [
        hostname(),
        platform(),
        arch(),
        cpus()[0]?.model || 'unknown',
        process.env.USER || process.env.USERNAME || 'unknown',
      ].join('|');
      
      return createHash('sha256').update(data).digest('hex');
    } catch {
      return 'unknown-device';
    }
  }

  /**
   * Load consent from config file
   */
  private loadConsent(): TelemetryConsent {
    try {
      if (existsSync(CONFIG_FILE)) {
        const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
        return config.consent || this.getDefaultConsent();
      }
    } catch {
      // Ignore errors
    }
    return this.getDefaultConsent();
  }

  /**
   * Get default consent (disabled by default)
   */
  private getDefaultConsent(): TelemetryConsent {
    return {
      enabled: false,
      tier: 2 as ConsentTier,  // Default tier when enabled
      data_types: {
        prompt_completions: true,
        error_fixes: true,
        refactorings: true,
        m7_sessions: true,
        code_diffs: false,      // Tier 3 — requires explicit opt-in
        feedback: true,
      },
    };
  }

  /**
   * Save consent to config file
   */
  private saveConsent(): void {
    try {
      const config = existsSync(CONFIG_FILE)
        ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
        : {};
      
      config.consent = this.consent;
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
      log.debug('Telemetry] Error saving consent:', error);
    }
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.consent.enabled;
  }

  /**
   * Check if specific event type is enabled based on consent tier
   */
  isEventTypeEnabled(type: TelemetryEvent['type']): boolean {
    if (!this.consent.enabled) return false;
    
    switch (type) {
      case 'prompt_completion':
        return this.consent.data_types.prompt_completions;
      case 'error_fix':
        return this.consent.data_types.error_fixes;
      case 'refactoring':
        return this.consent.data_types.refactorings;
      case 'm7_session':
        return this.consent.data_types.m7_sessions;
      // v3.12: New semantic types
      case 'investigation':
      case 'hive_coordination':
        return this.consent.data_types.prompt_completions; // Same tier as prompts
      case 'code_diff':
        return this.consent.data_types.code_diffs;  // Tier 3 required
      case 'feedback':
        return this.consent.data_types.feedback;
      // CNP events — same tier as prompts
      default:
        return this.consent.data_types.prompt_completions;
    }
  }

  /**
   * Enable telemetry with consent
   */
  async enableTelemetry(dataTypes?: Partial<TelemetryConsent['data_types']>): Promise<boolean> {
    if (!this.remoteEnabled) {
      log.debug('Telemetry] Remote endpoint not configured (M7_TELEMETRY_ENDPOINT) — upload cannot be enabled');
      return false;
    }
    try {
      // Register consent with server
      const response = await fetch(`${this.config.endpoint}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_hash: this.deviceHash,
          data_types: dataTypes || this.consent.data_types,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        this.consent = {
          enabled: true,
          consented_at: result.consented_at,
          tier: this.consent.tier || 2 as ConsentTier,
          data_types: dataTypes 
            ? { ...this.consent.data_types, ...dataTypes }
            : this.consent.data_types,
        };
        this.saveConsent();
        this.startFlushTimer();
        return true;
      }
      
      return false;
    } catch (error) {
      log.debug('Telemetry] Error enabling telemetry:', error);
      return false;
    }
  }

  /**
   * Disable telemetry and withdraw consent
   */
  async disableTelemetry(): Promise<boolean> {
    if (!this.remoteEnabled) {
      this.consent.enabled = false;
      this.saveConsent();
      this.stopFlushTimer();
      this.buffer = [];
      return true;
    }
    try {
      // Withdraw consent on server
      const response = await fetch(`${this.config.endpoint}/consent`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_hash: this.deviceHash }),
      });

      // Update local state regardless of server response
      this.consent.enabled = false;
      this.saveConsent();
      this.stopFlushTimer();
      this.buffer = []; // Clear any pending events
      
      return response.ok;
    } catch (error) {
      log.debug('Telemetry] Error disabling telemetry:', error);
      // Still disable locally
      this.consent.enabled = false;
      this.saveConsent();
      return false;
    }
  }

  /**
   * Collect a telemetry event
   */
  collect(event: TelemetryEvent): void {
    if (!this.isEventTypeEnabled(event.type)) {
      return;
    }

    // Add timestamp if not present
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }

    this.buffer.push(event);

    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Start the flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;
    
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush buffered events to server
   */
  async flush(): Promise<TelemetryBatchResponse | null> {
    if (!this.remoteEnabled) {
      // No upload target configured — telemetry stays local-only.
      this.buffer = [];
      return null;
    }
    if (this.isFlushing || this.buffer.length === 0 || !this.consent.enabled) {
      return null;
    }

    this.isFlushing = true;
    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      // Sanitize events
      const sanitizedEvents = sanitizeBatch(eventsToSend);
      
      if (sanitizedEvents.length === 0) {
        log.debug('Telemetry] All events filtered out during sanitization');
        return null;
      }

      const batch: TelemetryBatchRequest = {
        batch_id: randomUUID(),
        device_hash: this.deviceHash,
        m7_version: this.m7Version,
        events: sanitizedEvents,
      };

      const response = await this.sendBatch(batch);
      
      if (response?.success) {
        log.debug(`Telemetry] Batch sent: ${response.events_accepted} accepted, ${response.events_rejected} rejected`);
      }
      
      return response;
    } catch (error) {
      log.debug('Telemetry] Flush error:', error);
      // Put events back in buffer for retry (up to max size)
      this.buffer = [...eventsToSend.slice(0, this.config.batchSize - this.buffer.length), ...this.buffer];
      return null;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Send batch to server with retries
   */
  private async sendBatch(batch: TelemetryBatchRequest, retries: number = 0): Promise<TelemetryBatchResponse | null> {
    try {
      const response = await fetch(`${this.config.endpoint}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-M7-Device-ID': this.deviceHash,
          'X-M7-Version': this.m7Version,
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        if (response.status === 429 && retries < this.config.maxRetries) {
          // Rate limited, retry with backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
          return this.sendBatch(batch, retries + 1);
        }
        throw new Error(`Server returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (retries < this.config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
        return this.sendBatch(batch, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Get telemetry statistics
   */
  async getStats(): Promise<TelemetryStats | null> {
    if (!this.remoteEnabled) {
      return null;
    }
    try {
      const response = await fetch(`${this.config.endpoint}/code-stats`, {
        headers: {
          'X-M7-Device-ID': this.deviceHash,
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      log.debug('Telemetry] Error fetching stats:', error);
      return null;
    }
  }

  /**
   * Get current consent status
   */
  getConsentStatus(): TelemetryConsent {
    return { ...this.consent };
  }

  /**
   * Get device hash (for display)
   */
  getDeviceHash(): string {
    return this.deviceHash.substring(0, 8) + '...';
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  // =========================================
  // v3.12: Session & semantic event helpers
  // =========================================

  /**
   * Set active M7 session ID (links all subsequent events)
   */
  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.sessionToolCalls = [];
  }

  /**
   * Clear active session
   */
  clearActiveSession(): void {
    this.activeSessionId = null;
    this.sessionToolCalls = [];
  }

  /**
   * Get active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /**
   * Get tool calls made in current session (for linking to code_diff)
   */
  getSessionToolCalls(): string[] {
    return [...this.sessionToolCalls];
  }

  // =========================================
  // v3.13: Episode tracking
  // =========================================

  /**
   * Start a new episode (groups related tool calls into a training trajectory)
   * Episode is auto-created from session if not explicitly set.
   */
  startEpisode(episodeId?: string): string {
    this.activeEpisodeId = episodeId || `ep_${Date.now()}_${randomUUID().substring(0, 8)}`;
    this.episodeEventCount = 0;
    return this.activeEpisodeId;
  }

  /**
   * End the current episode
   */
  endEpisode(): void {
    this.activeEpisodeId = null;
    this.episodeEventCount = 0;
  }

  /**
   * Get active episode ID
   */
  getActiveEpisodeId(): string | null {
    return this.activeEpisodeId;
  }

  /**
   * Auto-derive episode_id: use explicit episode > session > null
   */
  private deriveEpisodeId(): string | undefined {
    if (this.activeEpisodeId) return this.activeEpisodeId;
    if (this.activeSessionId) return `ses_${this.activeSessionId}`;
    return undefined;
  }

  /**
   * Collect a semantically typed tool call event.
   * Automatically classifies based on tool name.
   */
  collectToolCall(toolName: string, prompt: string, response: string, durationMs: number): void {
    // Track tool call in session
    this.sessionToolCalls.push(toolName);

    const eventType = classifyToolEvent(toolName);

    switch (eventType) {
      case 'investigation':
        this.collect({
          type: 'investigation',
          timestamp: new Date().toISOString(),
          session_id: this.activeSessionId || undefined,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          query: prompt.substring(0, 500),
          result_summary: response.substring(0, 2000),
          duration_ms: durationMs,
        } as InvestigationEvent);
        break;

      case 'hive_coordination':
        // Parse confidence and experts from response if possible
        let experts = 0;
        let confidence = 0;
        let mode = 'dynamic';
        try {
          const confMatch = response.match(/Confidence['":\s]*(\d+(?:\.\d+)?)/i);
          const expMatch = response.match(/Expert.*?:\s*(\d+)/i);
          const modeMatch = response.match(/Mode['":\s]*(dynamic|fixed|planned)/i);
          if (confMatch) confidence = parseFloat(confMatch[1]);
          if (expMatch) experts = parseInt(expMatch[1]);
          if (modeMatch) mode = modeMatch[1];
        } catch { /* ignore parse errors */ }

        this.collect({
          type: 'hive_coordination',
          timestamp: new Date().toISOString(),
          session_id: this.activeSessionId || undefined,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          task_summary: prompt.substring(0, 500),
          experts_count: experts,
          confidence,
          duration_ms: durationMs,
          mode,
        } as HiveCoordinationEvent);
        break;

      case 'error_fix': {
        // Parse error details from prompt/response
        let errorMessage = prompt.substring(0, 300);
        let errorType = 'unknown';
        let fixExplanation = response.substring(0, 2000);
        try {
          const typeMatch = prompt.match(/(?:category|type)['":\s]*["']?(\w+)/i);
          if (typeMatch) errorType = typeMatch[1];
        } catch { /* ignore */ }

        this.collect({
          type: 'error_fix',
          timestamp: new Date().toISOString(),
          session_id: this.activeSessionId || undefined,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          error: {
            message: errorMessage,
            type: errorType,
          },
          fix: {
            code_after: fixExplanation,
            explanation: `Tool: ${toolName}`,
            iterations: 1,
          },
          feedback: {
            time_to_fix: durationMs,
          },
        } as ErrorFixEvent);
        break;
      }

      case 'm7_session': {
        // Parse session details from prompt/response
        let sessionId = this.activeSessionId || 'unknown';
        let route: 'light' | 'medium' | 'heavy' | 'decompose' = 'heavy';
        let phasesCompleted: string[] = [];
        let taskDesc = prompt.substring(0, 500);
        try {
          const routeMatch = response.match(/(?:route|Route)['":\s]*["']?(light|medium|heavy|decompose)/i);
          if (routeMatch) route = routeMatch[1] as typeof route;
          const phaseMatch = response.match(/(?:phase|Phase)['":\s]*["']?(\w+)/gi);
          if (phaseMatch) phasesCompleted = phaseMatch.map(p => p.replace(/.*?["']?(\w+)["']?$/, '$1'));
          const idMatch = response.match(/(?:session_id|Session ID)['":\s]*["']?([a-zA-Z0-9_-]+)/i);
          if (idMatch) sessionId = idMatch[1];
        } catch { /* ignore */ }

        this.collect({
          type: 'm7_session',
          timestamp: new Date().toISOString(),
          session_id: sessionId,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          session: {
            id: sessionId,
            route,
            phases_completed: phasesCompleted,
            duration_ms: durationMs,
          },
          task: {
            description: taskDesc,
          },
        } as M7SessionEvent);
        break;
      }

      case 'refactoring': {
        this.collect({
          type: 'refactoring',
          timestamp: new Date().toISOString(),
          session_id: this.activeSessionId || undefined,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          intent: toolName,
          before: {
            code: prompt.substring(0, 2000),
          },
          after: {
            code: response.substring(0, 2000),
          },
          metadata: {
            pattern: toolName,
          },
        } as RefactoringEvent);
        break;
      }

      default:
        // Keep backward compatible prompt_completion for unclassified tools
        // v3.13: Now includes tool_name and episode_id for training data quality
        this.collect({
          type: 'prompt_completion',
          timestamp: new Date().toISOString(),
          session_id: this.activeSessionId || undefined,
          episode_id: this.deriveEpisodeId(),
          tool_name: toolName,
          schema_version: TelemetryCollector.SCHEMA_VERSION,
          prompt: prompt.substring(0, 500),
          context: {
            m7_route: undefined,
            m7_phase: undefined,
          },
          completion: {
            code: response.substring(0, 5000),
            model: undefined, // v3.13: Don't hardcode model — unknown at this layer
          },
          feedback: {
            time_to_accept: durationMs,
          },
        });
        break;
    }
  }

  /**
   * Collect a code diff event from a git commit
   */
  collectCodeDiff(diff: CodeDiffEvent['diff'], commit?: CodeDiffEvent['commit']): void {
    this.collect({
      type: 'code_diff',
      timestamp: new Date().toISOString(),
      session_id: this.activeSessionId || undefined,
      episode_id: this.deriveEpisodeId(),
      tool_name: 'git_capture',
      schema_version: TelemetryCollector.SCHEMA_VERSION,
      diff,
      commit,
      linked_tools: this.getSessionToolCalls(),
    } as CodeDiffEvent);
  }

  /**
   * Collect a feedback signal
   */
  collectFeedback(
    suggestionId: string, 
    signal: FeedbackEvent['signal'], 
    source: FeedbackEvent['source'],
    details?: FeedbackEvent['details']
  ): void {
    this.collect({
      type: 'feedback',
      timestamp: new Date().toISOString(),
      session_id: this.activeSessionId || undefined,
      episode_id: this.deriveEpisodeId(),
      tool_name: 'feedback',
      schema_version: TelemetryCollector.SCHEMA_VERSION,
      suggestion_id: suggestionId,
      signal,
      source,
      details,
    } as FeedbackEvent);
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    this.stopFlushTimer();
    if (this.buffer.length > 0 && this.consent.enabled) {
      await this.flush();
    }
  }
}

// Singleton instance
let collector: TelemetryCollector | null = null;

/**
 * Get the singleton TelemetryCollector instance
 */
export function getTelemetryCollector(): TelemetryCollector {
  if (!collector) {
    collector = new TelemetryCollector();
  }
  return collector;
}

/**
 * Convenience function to collect an event
 */
export function collectTelemetry(event: TelemetryEvent): void {
  getTelemetryCollector().collect(event);
}
