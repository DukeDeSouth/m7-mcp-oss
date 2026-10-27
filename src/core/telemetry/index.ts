/**
 * M7 Hook Telemetry Facade
 * 
 * Singleton facade for reading Cursor Hook telemetry,
 * computing freestyle risk, and tracking DISCOVERY phase.
 * 
 * v7.0: Core telemetry (ingester, freestyle, discovery)
 * v7.1: File-based insights (writeInsights → current.json)
 * v7.2: WebSocket push server for real-time Extension updates
 * 
 * Usage:
 *   const telemetry = getHookTelemetry(projectPath);
 *   telemetry.startRealtimePush();  // Start WS server + background polling
 *   const enrichment = telemetry.getEnrichment();
 * 
 * @module core/telemetry
 * @since v7.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { HookTelemetryIngester } from './ingester.js';
import { FreestyleDetector } from './freestyleDetector.js';
import { DiscoveryTracker } from './discoveryTracker.js';
import { TelemetryWsServer } from './wsServer.js';
import { SessionStore } from './sessionStore.js';
import type { TelemetryEnrichment, TelemetrySnapshot } from './types.js';

let _instance: HookTelemetryFacade | null = null;

export class HookTelemetryFacade {
  private ingester: HookTelemetryIngester;
  private freestyleDetector: FreestyleDetector;
  private discoveryTracker: DiscoveryTracker;
  private initialized: boolean = false;
  private readonly projectPath: string;

  // v7.2: WebSocket push server + background polling
  private wsServer: TelemetryWsServer | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPushEventTs: string = '';
  private sessionStore: SessionStore;
  // v7.3: Sessions broadcast counter (broadcast every ~30s, not every 2s)
  private sessionsBroadcastCounter: number = 0;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.ingester = new HookTelemetryIngester(projectPath);
    this.freestyleDetector = new FreestyleDetector();
    this.discoveryTracker = new DiscoveryTracker();
    this.sessionStore = new SessionStore(projectPath);
  }

  /**
   * Get telemetry enrichment for MCP tool responses.
   * Returns null if no events file exists (hooks not installed).
   */
  getEnrichment(): TelemetryEnrichment | null {
    try {
      if (!this.ingester.hasEvents()) {
        return null;
      }

      if (!this.initialized) {
        this.ingester.rotate();
        this.ingester.cleanup();
        this.initialized = true;
      }

      const snapshot = this.ingester.getSnapshot();
      if (snapshot.event_count === 0) {
        return null;
      }

      return this.computeEnrichment(snapshot);
    } catch {
      return null;
    }
  }

  /**
   * Get raw snapshot for debugging/inspection.
   */
  getSnapshot(): TelemetrySnapshot | null {
    try {
      if (!this.ingester.hasEvents()) return null;
      return this.ingester.getSnapshot();
    } catch {
      return null;
    }
  }

  /**
   * Force rotation and cleanup.
   */
  maintenance(): { rotated: boolean; deletedFiles: number } {
    const rotated = this.ingester.rotate();
    const deletedFiles = this.ingester.cleanup();
    return { rotated, deletedFiles };
  }

  /**
   * Start real-time push system:
   * 1. WebSocket server on random port (port written to .m7/ws-port)
   * 2. Background polling of events.jsonl (every 2s)
   * 3. Push enrichment to all connected Extension clients on change
   * 4. File-based writeInsights() as fallback (backwards compatible)
   * 
   * @param pollIntervalMs How often to check for new events (default: 2000)
   * @since v7.2
   */
  async startRealtimePush(pollIntervalMs: number = 2000): Promise<void> {
    if (this.wsServer) return; // Already running

    // v7.3: Write clean initial state immediately on MCP start.
    // This prevents stale current.json from previous session showing in Dashboard.
    this.writeInsights({
      freestyle_risk: 'low',
      freestyle_signals: {
        code_volume_spike: false,
        hypothesis_absence: false,
        convergence_velocity: false,
        backtrack_absence: false,
        tool_avoidance: false,
      },
      freestyle_hint: '',
      discovery_phase: 'E0_none',
      discovery_collapsed: false,
      session_duration_s: 0,
      tool_calls_count: 0,
      file_edits: 0,
      lines_changed: 0,
      thinking_time_s: 0,
    });

    try {
      // Start WebSocket server
      this.wsServer = new TelemetryWsServer(this.projectPath);
      await this.wsServer.start();

      // Register session handler for cross-session trend requests
      this.wsServer.onSessionsRequest(() => this.sessionStore.getRecentSessions(20));

      // Start background polling
      this.pollTimer = setInterval(() => this.pushTick(), pollIntervalMs);
      if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
        (this.pollTimer as NodeJS.Timeout).unref();
      }
    } catch {
      // WS server failed to start — no real-time updates, but MCP still works
      this.wsServer = null;
    }
  }

  /**
   * Stop real-time push system. Call on shutdown.
   * v7.5: Marks current session as "ended" so it survives restart.
   * @since v7.2
   */
  stopRealtimePush(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // v7.5: Mark session as "ended" before shutdown.
    // Without this, closeOrphanedSessions() deletes all "active" sessions on restart,
    // destroying historical data for Session Trends chart.
    try {
      this.sessionStore.endSession();
    } catch { /* fail-silent on shutdown */ }
    if (this.wsServer) {
      this.wsServer.stop();
      this.wsServer = null;
    }
  }

  /**
   * Background poll tick: read new events, compute, push via WS + write file.
   * v7.5: Always broadcast via WS (session_duration_s needs real-time updates).
   *       Only dedup file writes and session saves to reduce disk IO.
   * @since v7.2
   */
  private pushTick(): void {
    try {
      if (!this.ingester.hasEvents()) return;

      if (!this.initialized) {
        this.ingester.rotate();
        this.ingester.cleanup();
        this.initialized = true;
      }

      const snapshot = this.ingester.getSnapshot();
      if (snapshot.event_count === 0) return;

      const enrichment = this.computeEnrichment(snapshot);
      if (!enrichment) return;

      // v7.5: ALWAYS push via WebSocket — session_duration_s and updated_at must tick
      if (this.wsServer) {
        this.wsServer.broadcast(enrichment);
      }

      // Dedup for disk IO: only write file and save session when new events arrive
      const hasNewEvents = snapshot.last_event_ts !== this.lastPushEventTs;
      if (hasNewEvents) {
        this.lastPushEventTs = snapshot.last_event_ts;

        // Write file (backwards compatible fallback)
        this.writeInsights(enrichment);

        // Persist session data for cross-session trends
        this.sessionStore.saveSessionSnapshot(enrichment, snapshot);
      }

      // v7.3: Broadcast sessions periodically (~every 30s) so Dashboard stays updated
      this.sessionsBroadcastCounter++;
      if (this.sessionsBroadcastCounter >= 15 && this.wsServer) {
        this.sessionsBroadcastCounter = 0;
        const sessions = this.sessionStore.getRecentSessions(20);
        this.wsServer.broadcastSessions(sessions);
      }
    } catch {
      // Fail silently
    }
  }

  /**
   * Compute enrichment from snapshot.
   * Shared between getEnrichment() and pushTick().
   */
  private computeEnrichment(snapshot: TelemetrySnapshot): TelemetryEnrichment {
    const freestyle = this.freestyleDetector.analyze(snapshot);
    const discovery = this.discoveryTracker.track(snapshot.events);

    return {
      freestyle_risk: freestyle.risk,
      freestyle_signals: freestyle.signals,
      freestyle_hint: freestyle.hint,
      discovery_phase: discovery.phase,
      discovery_collapsed: discovery.collapsed,
      session_duration_s: snapshot.session_duration_s,
      tool_calls_count: snapshot.event_count,
      file_edits: snapshot.file_edits,
      lines_changed: snapshot.total_lines_added + snapshot.total_lines_removed,
      thinking_time_s: Math.round(snapshot.thinking_total_ms / 1000),
    };
  }

  /**
   * Write insights to .m7/insights/current.json for Extension UI.
   * Atomic: writes tmp file then renames.
   * Fail-silent: never throws.
   * 
   * @since v7.1
   */
  writeInsights(enrichment: TelemetryEnrichment): void {
    try {
      const insightsDir = path.join(this.projectPath, '.m7', 'insights');
      const insightsFile = path.join(insightsDir, 'current.json');
      const tmpFile = path.join(insightsDir, '.current.json.tmp');

      if (!fs.existsSync(insightsDir)) {
        fs.mkdirSync(insightsDir, { recursive: true });
      }

      const data = {
        updated_at: new Date().toISOString(),
        freestyle_risk: enrichment.freestyle_risk,
        freestyle_hint: enrichment.freestyle_hint,
        discovery_phase: enrichment.discovery_phase,
        discovery_collapsed: enrichment.discovery_collapsed,
        session_duration_s: enrichment.session_duration_s,
        tool_calls: enrichment.tool_calls_count,
        file_edits: enrichment.file_edits,
        lines_changed: enrichment.lines_changed,
        thinking_time_s: enrichment.thinking_time_s,
      };

      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, insightsFile);
    } catch {
      // Fail silently
    }
  }
}

/**
 * Get the singleton HookTelemetryFacade.
 * Lazy: creates instance on first call.
 */
export function getHookTelemetry(projectPath?: string): HookTelemetryFacade {
  if (!_instance && projectPath) {
    _instance = new HookTelemetryFacade(projectPath);
  }
  if (!_instance) {
    _instance = new HookTelemetryFacade(process.cwd());
  }
  return _instance;
}

/**
 * Get existing singleton without creating new.
 * Used by graceful shutdown to stop telemetry if it was initialized.
 * Returns null if getHookTelemetry() was never called.
 * @since v7.4
 */
export function getHookTelemetryIfExists(): HookTelemetryFacade | null {
  return _instance;
}

// Re-export types
export * from './types.js';
export { HookTelemetryIngester } from './ingester.js';
export { FreestyleDetector } from './freestyleDetector.js';
export { DiscoveryTracker } from './discoveryTracker.js';
export { TelemetryWsServer } from './wsServer.js';
export { SessionStore } from './sessionStore.js';
export type { SessionSummary } from './sessionStore.js';
