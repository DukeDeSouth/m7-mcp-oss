import { createLogger } from '../utils/logger.js';
const log = createLogger('[filewatcher]');
/**
 * M7 v3.6 - Shared File Watcher
 * 
 * Централизованный file watcher для всех auto-систем M7:
 * - Knowledge Graph incremental updates
 * - ChromaDB reindexing
 * - Project Index updates
 * - Style Guardian checks
 */

import chokidar from 'chokidar';
import * as path from 'path';

// ============================================
// TYPES
// ============================================

export interface FileWatcherConfig {
  /** Glob patterns to watch */
  patterns: string[];
  /** Patterns to ignore */
  ignored: (string | RegExp)[];
  /** Debounce delay in ms */
  debounceMs: number;
}

export type FileChangeEvent = 'add' | 'change' | 'unlink';
export type FileChangeHandler = (event: FileChangeEvent, filePath: string) => void;

// ============================================
// DEFAULT CONFIG
// ============================================

const DEFAULT_CONFIG: FileWatcherConfig = {
  patterns: [
    '**/*.ts',
    '**/*.tsx', 
    '**/*.js',
    '**/*.jsx',
    '**/*.json',
    '**/*.md'
  ],
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.m7/**',
    '**/*.d.ts',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**'
  ],
  debounceMs: 500
};

// ============================================
// FILE WATCHER CLASS
// ============================================

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private handlers: Map<string, FileChangeHandler> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: FileWatcherConfig;
  private rootPath: string = '';
  private isRunning: boolean = false;

  constructor(config?: Partial<FileWatcherConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start watching the specified directory
   */
  start(rootPath: string): void {
    if (this.isRunning) {
      log.debug('FileWatcher] Already running');
      return;
    }
    
    this.rootPath = rootPath;
    
    try {
      this.watcher = chokidar.watch(this.config.patterns, {
        cwd: rootPath,
        ignored: this.config.ignored,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        },
        // Performance optimizations
        usePolling: false,
        alwaysStat: false,
        depth: 10
      });

      // Subscribe to events
      const events: FileChangeEvent[] = ['add', 'change', 'unlink'];
      events.forEach(event => {
        this.watcher!.on(event, (filePath: string) => {
          this.handleEvent(event, filePath);
        });
      });

      this.watcher.on('ready', () => {
        log.debug(`FileWatcher] Ready, watching ${rootPath}`);
      });

      this.watcher.on('error', (error) => {
        log.debug('FileWatcher] Error:', error.message);
      });

      this.isRunning = true;
    } catch (error: any) {
      log.debug('FileWatcher] Failed to start:', error.message);
      throw error;
    }
  }

  /**
   * Subscribe to file changes
   */
  subscribe(id: string, handler: FileChangeHandler): void {
    this.handlers.set(id, handler);
    log.debug(`FileWatcher] Subscriber added: ${id}`);
  }

  /**
   * Unsubscribe from file changes
   */
  unsubscribe(id: string): void {
    this.handlers.delete(id);
    log.debug(`FileWatcher] Subscriber removed: ${id}`);
  }

  /**
   * Handle file change event with debouncing
   */
  private handleEvent(event: FileChangeEvent, relativePath: string): void {
    const fullPath = path.join(this.rootPath, relativePath);
    const key = `${event}:${relativePath}`;
    
    // Clear existing debounce timer for this file
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debounce timer
    this.debounceTimers.set(key, setTimeout(() => {
      // Notify all handlers
      this.handlers.forEach((handler, handlerId) => {
        try {
          handler(event, fullPath);
        } catch (error: any) {
          log.debug(`FileWatcher] Handler ${handlerId} error:`, error.message);
        }
      });
      this.debounceTimers.delete(key);
    }, this.config.debounceMs));
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.watcher?.close();
    this.watcher = null;
    
    // Clear all pending timers
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    
    this.isRunning = false;
    log.debug('FileWatcher] Stopped');
  }

  /**
   * Get current subscriber count
   */
  get subscriberCount(): number {
    return this.handlers.size;
  }

  /**
   * Check if watcher is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get watched root path
   */
  get watchedPath(): string {
    return this.rootPath;
  }
}

// ============================================
// SINGLETON
// ============================================

let watcherInstance: FileWatcher | null = null;

/**
 * Get or create the singleton FileWatcher instance
 */
export function getFileWatcher(): FileWatcher {
  if (!watcherInstance) {
    watcherInstance = new FileWatcher();
  }
  return watcherInstance;
}

/**
 * Create a new FileWatcher instance with custom config
 */
export function createFileWatcher(config?: Partial<FileWatcherConfig>): FileWatcher {
  return new FileWatcher(config);
}

export default FileWatcher;
