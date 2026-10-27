/**
 * M7 Mesh Signals — Filesystem-based notification system
 * Uses fs.watch on a signals directory for near-real-time IPC.
 * @module mesh/MeshSignals
 * @since v8.0
 */

import { watch, type FSWatcher } from 'fs';
import { writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SignalType } from './types.js';

export class MeshSignals {
  private signalsDir: string;
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs = 50;

  constructor(signalsDir: string) {
    this.signalsDir = signalsDir;
    if (!existsSync(signalsDir)) {
      mkdirSync(signalsDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Start watching for signal files.
   * Callback receives (type, instanceId) extracted from filename.
   */
  start(onSignal: (type: string, instanceId: string) => void): void {
    if (this.watcher) return; // Already watching

    try {
      this.watcher = watch(this.signalsDir, { persistent: false }, (eventType, filename) => {
        if (!filename || eventType !== 'rename') return;

        // Debounce rapid events
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          // Parse signal filename: {type}_{epoch}_{instanceId}
          const parts = filename.split('_');
          if (parts.length >= 3) {
            const type = parts[0];
            const instanceId = parts.slice(2).join('_'); // instanceId may contain underscores
            onSignal(type, instanceId);
          }
        }, this.debounceMs);
      });

      // Don't let the watcher keep the process alive
      this.watcher.unref();
    } catch {
      // fs.watch can fail on some filesystems — non-fatal
      this.watcher = null;
    }
  }

  /**
   * Emit a signal by creating a file in the signals directory.
   * Other instances watching the directory will receive the notification.
   */
  emit(type: SignalType, instanceId: string): void {
    try {
      const filename = `${type}_${Date.now()}_${instanceId}`;
      writeFileSync(join(this.signalsDir, filename), '', { mode: 0o600 });
    } catch {
      // Non-fatal: signal emission failure doesn't break functionality
    }
  }

  /**
   * Remove signal files older than ttlMs.
   */
  cleanup(ttlMs: number = 60_000): void {
    try {
      const now = Date.now();
      const files = readdirSync(this.signalsDir);
      
      for (const file of files) {
        // Extract epoch from filename: {type}_{epoch}_{instanceId}
        const parts = file.split('_');
        if (parts.length >= 2) {
          const epoch = parseInt(parts[1], 10);
          if (!isNaN(epoch) && (now - epoch) > ttlMs) {
            try {
              unlinkSync(join(this.signalsDir, file));
            } catch {
              // File already removed or permission issue — ignore
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Stop watching for signals.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
