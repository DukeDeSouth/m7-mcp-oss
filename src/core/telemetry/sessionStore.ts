/**
 * M7 Telemetry Session Store
 * 
 * Persists session summaries to .m7/insights/sessions/ for cross-session
 * trend analysis. Each session gets a JSON file with aggregated metrics.
 * 
 * Sessions are detected from hook events:
 * - session_start event → new session begins
 * - stop event → session ends
 * - 5 minute gap between events → implicit session end
 * 
 * @module core/telemetry/sessionStore
 * @since v7.2
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TelemetryEnrichment, TelemetrySnapshot } from './types.js';

/** Max session files to keep */
const MAX_SESSION_FILES = 50;

/** Max age of session files in days */
const MAX_SESSION_AGE_DAYS = 30;

/** Gap threshold for implicit session end (5 minutes) */
const SESSION_GAP_MS = 5 * 60 * 1000;

export interface SessionSummary {
  id: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  tool_calls: number;
  file_edits: number;
  lines_changed: number;
  max_freestyle_risk: 'low' | 'medium' | 'high';
  freestyle_risk_history: Array<{ ts: string; risk: 'low' | 'medium' | 'high' }>;
  discovery_phases: string[];
  discovery_collapsed: boolean;
  thinking_time_s: number;
  shell_commands: number;
  status: 'active' | 'ended';
}

export class SessionStore {
  private readonly sessionsDir: string;
  private currentSessionId: string | null = null;
  private currentSessionPath: string | null = null;
  private maxRisk: 'low' | 'medium' | 'high' = 'low';
  private riskHistory: Array<{ ts: string; risk: 'low' | 'medium' | 'high' }> = [];
  private discoveryPhases: Set<string> = new Set();

  constructor(private readonly projectPath: string) {
    this.sessionsDir = path.join(projectPath, '.m7', 'insights', 'sessions');
    // v7.3: Close any leftover "active" sessions from previous MCP instances.
    // This prevents stale sessions from being overwritten or shown as current.
    this.closeOrphanedSessions();
  }

  /**
   * Delete sessions left "active" by a previous MCP instance that was killed.
   * These sessions contain data from a dead ingester — metrics are unreliable.
   * Ended sessions are preserved as valid historical data.
   * @since v7.3
   */
  private closeOrphanedSessions(): void {
    try {
      if (!fs.existsSync(this.sessionsDir)) return;
      const files = fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
      for (const file of files) {
        try {
          const filePath = path.join(this.sessionsDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const summary = JSON.parse(raw) as SessionSummary;
          if (summary.status === 'active') {
            // DELETE — data from dead MCP is unreliable
            fs.unlinkSync(filePath);
          }
        } catch { /* skip corrupt files */ }
      }
    } catch { /* fail silently */ }
  }

  /**
   * Update the current session with latest enrichment and snapshot.
   * Creates a new session file if none exists.
   */
  saveSessionSnapshot(enrichment: TelemetryEnrichment, snapshot: TelemetrySnapshot): void {
    try {
      this.ensureSessionsDir();

      // Detect session start
      if (!this.currentSessionId) {
        const startTs = snapshot.events.find(e => e.event === 'session_start')?.ts
          || snapshot.events[0]?.ts
          || new Date().toISOString();
        this.currentSessionId = this.makeSessionId(startTs);
        this.currentSessionPath = path.join(this.sessionsDir, `${this.currentSessionId}.json`);
        this.maxRisk = 'low';
        this.riskHistory = [];
        this.discoveryPhases = new Set();
      }

      // Track max risk
      if (this.riskLevel(enrichment.freestyle_risk) > this.riskLevel(this.maxRisk)) {
        this.maxRisk = enrichment.freestyle_risk;
      }

      // Track risk history (sample every update, capped at 100 points)
      if (this.riskHistory.length < 100) {
        this.riskHistory.push({
          ts: new Date().toISOString(),
          risk: enrichment.freestyle_risk,
        });
      }

      // Track discovery phases
      if (enrichment.discovery_phase) {
        this.discoveryPhases.add(enrichment.discovery_phase);
      }

      const summary: SessionSummary = {
        id: this.currentSessionId,
        started_at: snapshot.events[0]?.ts || new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_s: enrichment.session_duration_s,
        tool_calls: enrichment.tool_calls_count,
        file_edits: enrichment.file_edits,
        lines_changed: enrichment.lines_changed,
        max_freestyle_risk: this.maxRisk,
        freestyle_risk_history: this.riskHistory,
        discovery_phases: [...this.discoveryPhases],
        discovery_collapsed: enrichment.discovery_collapsed,
        thinking_time_s: enrichment.thinking_time_s,
        shell_commands: snapshot.shell_commands,
        status: 'active',
      };

      // Atomic write
      const tmpPath = this.currentSessionPath + '.tmp';
      fs.writeFileSync(tmpPath!, JSON.stringify(summary, null, 2));
      fs.renameSync(tmpPath!, this.currentSessionPath!);
    } catch {
      // Fail silently
    }
  }

  /**
   * Mark the current session as ended.
   */
  endSession(): void {
    if (!this.currentSessionPath) return;

    try {
      if (fs.existsSync(this.currentSessionPath)) {
        const raw = fs.readFileSync(this.currentSessionPath, 'utf-8');
        const summary = JSON.parse(raw) as SessionSummary;
        summary.status = 'ended';
        summary.ended_at = new Date().toISOString();
        fs.writeFileSync(this.currentSessionPath, JSON.stringify(summary, null, 2));
      }
    } catch {
      // Fail silently
    }

    this.currentSessionId = null;
    this.currentSessionPath = null;
  }

  /**
   * Get recent session summaries, sorted newest first.
   */
  getRecentSessions(limit: number = 10): SessionSummary[] {
    try {
      if (!fs.existsSync(this.sessionsDir)) return [];

      const files = fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .sort()
        .reverse()
        .slice(0, limit);

      const sessions: SessionSummary[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8');
          const summary = JSON.parse(raw) as SessionSummary;
          if (summary.id && summary.started_at) {
            sessions.push(summary);
          }
        } catch {
          // Skip corrupt files
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Get count of available session files.
   */
  getSessionCount(): number {
    try {
      if (!fs.existsSync(this.sessionsDir)) return 0;
      return fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .length;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up old session files.
   */
  cleanup(): number {
    try {
      if (!fs.existsSync(this.sessionsDir)) return 0;

      const files = fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .sort();

      let deleted = 0;
      const cutoffMs = Date.now() - (MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000);

      // Delete by age
      for (const file of files) {
        try {
          const filePath = path.join(this.sessionsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoffMs) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch { /* skip */ }
      }

      // Delete by count (keep newest MAX_SESSION_FILES)
      const remaining = fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .sort();

      if (remaining.length > MAX_SESSION_FILES) {
        const toDelete = remaining.slice(0, remaining.length - MAX_SESSION_FILES);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(path.join(this.sessionsDir, file));
            deleted++;
          } catch { /* skip */ }
        }
      }

      return deleted;
    } catch {
      return 0;
    }
  }

  // ─── Helpers ─────────────────────────────────────

  private ensureSessionsDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private makeSessionId(ts: string): string {
    // Format: session-2026-02-09-1430
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `session-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  private riskLevel(risk: 'low' | 'medium' | 'high'): number {
    return risk === 'low' ? 0 : risk === 'medium' ? 1 : 2;
  }
}
