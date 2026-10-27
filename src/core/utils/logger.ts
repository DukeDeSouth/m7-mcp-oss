/**
 * M7 MCP Logger Utility
 * 
 * Centralized logging that respects MCP JSON protocol.
 * MCP clients parse stderr as JSON, so we must avoid console.* in production.
 * 
 * Usage:
 *   import { logger } from './core/utils/logger.js';
 *   logger.debug('[Component] Debug message');
 *   logger.info('[Component] Info message');
 *   logger.warn('[Component] Warning');
 *   logger.error('[Component] Error', error);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  enabled?: boolean;
  level?: LogLevel;
  prefix?: string;
}

class Logger {
  private enabled: boolean;
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    // Only enable logging if M7_DEBUG=true
    this.enabled = options.enabled ?? (process.env.M7_DEBUG === 'true');
    this.level = options.level ?? 'debug';
    this.prefix = options.prefix ?? '[M7]';
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `${timestamp} ${levelStr} ${this.prefix} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.error(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.error(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.error(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      enabled: this.enabled,
      level: this.level,
      prefix: `${this.prefix} ${prefix}`
    });
  }

  /**
   * Temporarily enable logging for a specific operation
   */
  withLogging<T>(fn: () => T): T {
    const wasEnabled = this.enabled;
    this.enabled = true;
    try {
      return fn();
    } finally {
      this.enabled = wasEnabled;
    }
  }
}

// Global logger instance
export const logger = new Logger();

// Convenience function for creating scoped loggers
export function createLogger(prefix: string, options?: LoggerOptions): Logger {
  return new Logger({ ...options, prefix });
}

// Silent no-op logger for production
export const silentLogger = new Logger({ enabled: false });
