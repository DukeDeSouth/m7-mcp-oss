/**
 * M7 Hook Telemetry Ingester
 * 
 * Reads .m7/telemetry/events.jsonl written by Cursor Hooks.
 * Lazy: only reads on demand (when M7 tool is called).
 * Incremental: tracks last read position to avoid re-reading.
 * 
 * @module core/telemetry/ingester
 * @since v7.0
 */

import { existsSync, readFileSync, statSync, readdirSync, unlinkSync, renameSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import type { TelemetryEvent, TelemetrySnapshot } from './types.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RETENTION_DAYS = 7;
const MAX_TAIL_EVENTS = 200;

export class HookTelemetryIngester {
  private projectPath: string;
  private lastReadPosition: number = 0;
  private cachedEvents: TelemetryEvent[] = [];
  private sessionStartTs: string | null = null;
  private partialLine: string = '';

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Skip events from previous sessions — only track events written AFTER this MCP instance starts.
    // This ensures Discovery phase resets on new chat/session.
    this.skipToEnd();
  }

  /**
   * Skip to end of events file — ignore all pre-existing events.
   * Called on construction so each MCP session starts with fresh telemetry.
   */
  private skipToEnd(): void {
    const filePath = this.getEventsFilePath();
    if (!existsSync(filePath)) return;
    try {
      const stat = statSync(filePath);
      this.lastReadPosition = stat.size;
    } catch {
      // Graceful — start from beginning if we can't stat
    }
  }

  /**
   * Path to the active events file
   */
  private getEventsFilePath(): string {
    return join(this.projectPath, '.m7', 'telemetry', 'events.jsonl');
  }

  /**
   * Path to the telemetry directory
   */
  private getTelemetryDir(): string {
    return join(this.projectPath, '.m7', 'telemetry');
  }

  /**
   * Check if events file exists
   */
  hasEvents(): boolean {
    return existsSync(this.getEventsFilePath());
  }

  /**
   * Read new events since last read position.
   * Skips malformed lines gracefully.
   */
  readNewEvents(): TelemetryEvent[] {
    const filePath = this.getEventsFilePath();
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const stat = statSync(filePath);

      // File was truncated or rotated — reset
      if (stat.size < this.lastReadPosition) {
        this.lastReadPosition = 0;
        this.cachedEvents = [];
      }

      // Nothing new
      if (stat.size === this.lastReadPosition) {
        return [];
      }

      // Read ONLY new bytes using file descriptor with position offset.
      // This is critical: reading the whole file and using substring() with byte
      // positions is unreliable (byte vs char mismatch with multi-byte UTF-8).
      const fd = openSync(filePath, 'r');
      try {
        const bytesToRead = stat.size - this.lastReadPosition;
        const buffer = Buffer.alloc(bytesToRead);
        readSync(fd, buffer, 0, bytesToRead, this.lastReadPosition);
        const newContent = buffer.toString('utf-8');

        // Handle partial line from previous read boundary
        let lines = newContent.split('\n');
        // If we're not at the start, the first chunk might be a partial line
        // from the previous read. We store it and prepend to next read.
        if (this.lastReadPosition > 0 && this.partialLine) {
          lines[0] = this.partialLine + lines[0];
          this.partialLine = '';
        }
        // Last element might be partial (no trailing \n) — save for next read
        if (!newContent.endsWith('\n') && lines.length > 0) {
          this.partialLine = lines.pop() || '';
        }

        const newEvents: TelemetryEvent[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as TelemetryEvent;
            if (event.ts && event.event) {
              newEvents.push(event);
            }
          } catch {
            // Skip malformed lines — never crash
          }
        }

        this.lastReadPosition = stat.size;
        this.cachedEvents = [...this.cachedEvents, ...newEvents];

        // Track session start
        if (!this.sessionStartTs) {
          const sessionStart = this.cachedEvents.find(e => e.event === 'session_start');
          if (sessionStart) {
            this.sessionStartTs = sessionStart.ts;
          } else if (this.cachedEvents.length > 0) {
            this.sessionStartTs = this.cachedEvents[0].ts;
          }
        }

        return newEvents;
      } finally {
        closeSync(fd);
      }
    } catch {
      // Graceful — never crash
      return [];
    }
  }

  /**
   * Get a snapshot of current telemetry state.
   * Reads new events first, then computes summary.
   */
  getSnapshot(maxEvents: number = MAX_TAIL_EVENTS): TelemetrySnapshot {
    this.readNewEvents();

    const events = this.cachedEvents;
    const tailEvents = events.slice(-maxEvents);

    const toolCalls: Record<string, number> = {};
    let fileEdits = 0;
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    let thinkingTotalMs = 0;
    let thinkingCount = 0;
    let shellCommands = 0;

    for (const event of events) {
      switch (event.event) {
        case 'tool_start':
        case 'tool_end':
          if (event.tool_name) {
            toolCalls[event.tool_name] = (toolCalls[event.tool_name] || 0) + 1;
          }
          break;
        case 'file_edit':
          fileEdits++;
          totalLinesAdded += event.added_lines || 0;
          totalLinesRemoved += event.removed_lines || 0;
          break;
        case 'thinking':
          thinkingCount++;
          thinkingTotalMs += event.thinking_duration_ms || 0;
          break;
        case 'shell_exec':
          shellCommands++;
          break;
      }
    }

    const now = new Date();
    const sessionStartTime = this.sessionStartTs ? new Date(this.sessionStartTs) : now;
    const sessionDurationS = Math.max(0, (now.getTime() - sessionStartTime.getTime()) / 1000);

    return {
      session_duration_s: Math.round(sessionDurationS),
      event_count: events.length,
      tool_calls: toolCalls,
      file_edits: fileEdits,
      total_lines_added: totalLinesAdded,
      total_lines_removed: totalLinesRemoved,
      thinking_total_ms: thinkingTotalMs,
      thinking_count: thinkingCount,
      shell_commands: shellCommands,
      last_event_ts: events.length > 0 ? events[events.length - 1].ts : '',
      events: tailEvents,
    };
  }

  /**
   * Rotate events file if it exceeds max size.
   * Renames to events.YYYY-MM-DD.jsonl.
   */
  rotate(): boolean {
    const filePath = this.getEventsFilePath();
    if (!existsSync(filePath)) return false;

    try {
      const stat = statSync(filePath);
      if (stat.size < MAX_FILE_SIZE_BYTES) return false;

      const date = new Date().toISOString().split('T')[0];
      const rotatedPath = join(this.getTelemetryDir(), `events.${date}.jsonl`);
      
      renameSync(filePath, rotatedPath);
      this.lastReadPosition = 0;
      this.cachedEvents = [];
      this.sessionStartTs = null;
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete rotated files older than retention period.
   */
  cleanup(): number {
    const telemetryDir = this.getTelemetryDir();
    if (!existsSync(telemetryDir)) return 0;

    let deletedCount = 0;
    const cutoffMs = Date.now() - (MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    try {
      const files = readdirSync(telemetryDir);
      
      for (const file of files) {
        // Only clean rotated files (events.YYYY-MM-DD.jsonl)
        if (!file.startsWith('events.') || file === 'events.jsonl') continue;
        if (!file.endsWith('.jsonl')) continue;

        const filePath = join(telemetryDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < cutoffMs) {
            unlinkSync(filePath);
            deletedCount++;
          }
        } catch {
          // Skip files we can't stat/delete
        }
      }
    } catch {
      // Graceful
    }

    return deletedCount;
  }

  /**
   * Reset all state (useful for testing)
   */
  reset(): void {
    this.lastReadPosition = 0;
    this.cachedEvents = [];
    this.sessionStartTs = null;
    this.partialLine = '';
  }
}
