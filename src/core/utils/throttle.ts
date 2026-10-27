import { createLogger } from '../utils/logger.js';
const log = createLogger('[throttle]');
/**
 * M7 v3.6 - Throttle Manager
 * 
 * Utility for throttling function calls with minimum interval
 */

/**
 * ThrottleManager - manages throttled function calls
 */
export class ThrottleManager {
  /** Last run timestamp per key */
  private lastRun: Map<string, number> = new Map();
  
  /** Pending timeouts per key */
  private pending: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Throttle a function call
   * 
   * @param key Unique identifier for this throttle
   * @param fn Function to call
   * @param minIntervalMs Minimum interval between calls (ms)
   */
  throttle(key: string, fn: () => void | Promise<void>, minIntervalMs: number): void {
    const now = Date.now();
    const last = this.lastRun.get(key) || 0;
    const elapsed = now - last;

    // Clear any pending call
    const pendingTimeout = this.pending.get(key);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pending.delete(key);
    }

    if (elapsed >= minIntervalMs) {
      // Can run immediately
      this.lastRun.set(key, now);
      this.executeFunction(key, fn);
    } else {
      // Schedule for later
      const delay = minIntervalMs - elapsed;
      const timeout = setTimeout(() => {
        this.lastRun.set(key, Date.now());
        this.pending.delete(key);
        this.executeFunction(key, fn);
      }, delay);
      
      this.pending.set(key, timeout);
    }
  }

  /**
   * Execute function with error handling
   */
  private executeFunction(key: string, fn: () => void | Promise<void>): void {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch(error => {
          log.debug(`ThrottleManager] Error in throttled function '${key}':`, error.message);
        });
      }
    } catch (error: any) {
      log.debug(`ThrottleManager] Error in throttled function '${key}':`, error.message);
    }
  }

  /**
   * Cancel a pending throttled call
   */
  cancel(key: string): void {
    const pendingTimeout = this.pending.get(key);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pending.delete(key);
    }
  }

  /**
   * Clear all pending calls and reset state
   */
  clear(): void {
    this.pending.forEach(timeout => clearTimeout(timeout));
    this.pending.clear();
    this.lastRun.clear();
  }

  /**
   * Check if a key has a pending call
   */
  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  /**
   * Get time until next allowed call (ms)
   */
  getTimeUntilNextCall(key: string, minIntervalMs: number): number {
    const last = this.lastRun.get(key) || 0;
    const elapsed = Date.now() - last;
    return Math.max(0, minIntervalMs - elapsed);
  }
}

// ============================================
// SINGLETON
// ============================================

let throttleManagerInstance: ThrottleManager | null = null;

/**
 * Get or create the singleton ThrottleManager instance
 */
export function getThrottleManager(): ThrottleManager {
  if (!throttleManagerInstance) {
    throttleManagerInstance = new ThrottleManager();
  }
  return throttleManagerInstance;
}

export default ThrottleManager;
