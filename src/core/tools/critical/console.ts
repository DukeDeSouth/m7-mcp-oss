#!/usr/bin/env node

import { z } from 'zod';
import { JournalSystem } from '../../../journal/journalSystem.js';
import { BoundedMap } from '../../utils/boundedMap.js';
// v5.0: Memory parameter removed - console monitoring doesn't need memory

// Console monitoring types
interface ConsoleError {
  id: string;
  timestamp: Date;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  source: 'browser' | 'node' | 'playwright';
  context?: {
    file?: string;
    line?: number;
    column?: number;
    userAgent?: string;
    url?: string;
  };
  isLoop: boolean;
  frequency: number;
}

interface ConsoleFilter {
  excludeLoops: boolean;
  maxLength: number;
  severity: 'all' | 'error' | 'warn';
  excludePatterns: string[];
  includeContext: boolean;
}

class ConsoleMonitor {
  private static instance: ConsoleMonitor;
  private isActive: boolean = false;
  private errors: BoundedMap<string, ConsoleError> = new BoundedMap(100);
  private loopDetection: BoundedMap<string, number> = new BoundedMap(500);
  private filters: ConsoleFilter;
  private originalConsole: any;
  // v9.1: Guard against accumulating process.on() listeners on repeated start/stop
  private processIntercepted: boolean = false;
  // v9.2: Store handler refs for symmetric cleanup via process.off()
  private uncaughtHandler: ((error: Error) => void) | null = null;
  private rejectionHandler: ((reason: unknown) => void) | null = null;

  constructor(
    private journal: JournalSystem
  ) {
    this.filters = {
      excludeLoops: true,
      maxLength: 1000,
      severity: 'error',
      excludePatterns: [
        'chrome-extension://',
        'ResizeObserver loop limit exceeded',
        'Non-passive event listener',
        '__webpack_hmr'
      ],
      includeContext: true
    };
    this.originalConsole = { ...console };
  }

  static getInstance(journal: JournalSystem): ConsoleMonitor {
    if (!this.instance) {
      this.instance = new ConsoleMonitor(journal);
    }
    return this.instance;
  }

  start(): void {
    if (this.isActive) return;

    this.isActive = true;
    this.interceptConsole();
    this.interceptProcessErrors();
    
    this.journal.logFeature({
      name: 'Console Monitor',
      description: 'Started smart console monitoring',
      implementation: 'Console interception and filtering',
      lessons: [],
      patterns: ['console-monitoring'],
      complexity: 'medium'
    });
  }

  stop(): void {
    if (!this.isActive) return;

    this.isActive = false;
    this.restoreConsole();
    this.removeProcessErrors(); // v9.2: symmetric listener cleanup
    
    this.journal.logFeature({
      name: 'Console Monitor',
      description: 'Stopped console monitoring',
      implementation: 'Console monitoring disabled',
      lessons: [],
      patterns: ['console-monitoring'],
      complexity: 'light'
    });
  }

  private interceptConsole(): void {
    const monitor = this;

    ['error', 'warn', 'info'].forEach(level => {
      (console as any)[level] = function(...args: any[]) {
        // Call original console method
        monitor.originalConsole[level].apply(console, args);

        // Capture for monitoring
        if (monitor.shouldCapture(level as any)) {
          monitor.captureError(level as any, args);
        }
      };
    });
  }

  private interceptProcessErrors(): void {
    // v9.1: Only attach once — prevent listener accumulation on repeated start/stop
    if (this.processIntercepted) return;
    this.processIntercepted = true;
    
    if (typeof process !== 'undefined') {
      // v9.2: Store refs for symmetric removal in removeProcessErrors()
      this.uncaughtHandler = (error: Error) => {
        this.captureError('error', [error.message], {
          stack: error.stack,
          source: 'node'
        });
      };
      this.rejectionHandler = (reason: unknown) => {
        this.captureError('error', [reason], {
          source: 'node'
        });
      };
      process.on('uncaughtException', this.uncaughtHandler);
      process.on('unhandledRejection', this.rejectionHandler);
    }
  }

  private removeProcessErrors(): void {
    // v9.2: Symmetric cleanup — remove listeners added by interceptProcessErrors()
    if (!this.processIntercepted) return;
    if (typeof process !== 'undefined') {
      if (this.uncaughtHandler) process.off('uncaughtException', this.uncaughtHandler);
      if (this.rejectionHandler) process.off('unhandledRejection', this.rejectionHandler);
    }
    this.uncaughtHandler = null;
    this.rejectionHandler = null;
    this.processIntercepted = false;
  }

  private restoreConsole(): void {
    Object.assign(console, this.originalConsole);
  }

  private shouldCapture(level: 'error' | 'warn' | 'info'): boolean {
    if (!this.isActive) return false;
    
    if (this.filters.severity === 'error' && level !== 'error') return false;
    if (this.filters.severity === 'warn' && !['error', 'warn'].includes(level)) return false;
    
    return true;
  }

  private captureError(
    level: 'error' | 'warn' | 'info', 
    args: any[], 
    context?: Partial<ConsoleError['context'] & { stack?: string; source?: ConsoleError['source'] }>
  ): void {
    const message = this.formatMessage(args);
    const messageHash = this.hashMessage(message);

    // Loop detection
    const loopCount = this.loopDetection.get(messageHash) || 0;
    this.loopDetection.set(messageHash, loopCount + 1);

    const isLoop = loopCount > 3;
    if (isLoop && this.filters.excludeLoops) {
      return; // Skip repetitive errors
    }

    // Check exclude patterns
    if (this.filters.excludePatterns.some(pattern => message.includes(pattern))) {
      return;
    }

    const error: ConsoleError = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      message: this.truncateMessage(message),
      stack: context?.stack,
      source: context?.source || 'browser',
      context: this.filters.includeContext ? {
        file: context?.file,
        line: context?.line,
        column: context?.column,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        url: typeof window !== 'undefined' ? window.location?.href : undefined
      } : undefined,
      isLoop,
      frequency: loopCount + 1
    };

    this.errors.set(error.id, error);

    // Store in journal for persistence
    this.journal.logError({
      type: 'console_error',
      error: error.message,
      context: JSON.stringify({
        level: error.level,
        source: error.source,
        isLoop: error.isLoop,
        frequency: error.frequency,
        stack: error.stack
      }),
      fixed: false,
      category: 'runtime'
    });

    // Clean old errors (keep last 100)
    if (this.errors.size > 100) {
      const oldestId = Array.from(this.errors.keys())[0];
      this.errors.delete(oldestId);
    }
  }

  private formatMessage(args: any[]): string {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  private truncateMessage(message: string): string {
    if (message.length <= this.filters.maxLength) {
      return message;
    }
    
    return message.substring(0, this.filters.maxLength) + '\n... (truncated)';
  }

  private hashMessage(message: string): string {
    // Simple hash for loop detection
    return message.replace(/\d+/g, 'N').replace(/['"]/g, '').toLowerCase();
  }

  getErrors(limit: number = 20): ConsoleError[] {
    return Array.from(this.errors.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getRecentErrors(minutes: number = 10): ConsoleError[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return Array.from(this.errors.values())
      .filter(error => error.timestamp > cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  clearErrors(): void {
    this.errors.clear();
    this.loopDetection.clear();
  }

  updateFilters(newFilters: Partial<ConsoleFilter>): void {
    this.filters = { ...this.filters, ...newFilters };
  }

  formatForChat(errors: ConsoleError[]): string {
    if (errors.length === 0) {
      return "✅ No console errors detected";
    }

    let output = `🚨 **Console Errors Summary** (${errors.length} errors)\n\n`;

    errors.forEach((error, index) => {
      output += `**${index + 1}. ${error.level.toUpperCase()}** (${error.timestamp.toLocaleTimeString()})\n`;
      output += `\`\`\`\n${error.message}\n\`\`\`\n`;
      
      if (error.stack && error.level === 'error') {
        output += `**Stack Trace:**\n\`\`\`\n${error.stack.split('\n').slice(0, 5).join('\n')}\n\`\`\`\n`;
      }
      
      if (error.context?.file) {
        output += `**Location:** ${error.context.file}:${error.context.line}\n`;
      }
      
      if (error.isLoop) {
        output += `⚠️ **Loop detected** (frequency: ${error.frequency})\n`;
      }
      
      output += `**Source:** ${error.source}\n\n`;
    });

    return output;
  }
}

export const consoleTool = {
  name: 'mcp_m7_console',
  description: 'Smart console monitoring and error capture',
  inputSchema: z.object({
    action: z.enum(['start', 'stop', 'get_errors', 'clear', 'filter', 'status']),
    limit: z.number().default(20).optional(),
    minutes: z.number().default(10).optional(),
    filter: z.object({
      excludeLoops: z.boolean().default(true),
      maxLength: z.number().default(1000),
      severity: z.enum(['all', 'error', 'warn']).default('error'),
      excludePatterns: z.array(z.string()).default([]),
      includeContext: z.boolean().default(true)
    }).optional()
  }),

  handler: async (
    request: any, 
    systems: { journal: JournalSystem }
  ) => {
    const monitor = ConsoleMonitor.getInstance(systems.journal);

    switch (request.action) {
      case 'start':
        monitor.start();
        return {
          success: true,
          message: "✅ Console monitoring started",
          status: "active",
          filters: monitor['filters']
        };

      case 'stop':
        monitor.stop();
        return {
          success: true,
          message: "⏹️ Console monitoring stopped",
          status: "inactive"
        };

      case 'get_errors':
        const errors = request.minutes 
          ? monitor.getRecentErrors(request.minutes)
          : monitor.getErrors(request.limit);
        
        return {
          success: true,
          errors: errors,
          formatted: monitor.formatForChat(errors),
          count: errors.length,
          summary: `Found ${errors.length} console errors`
        };

      case 'clear':
        monitor.clearErrors();
        return {
          success: true,
          message: "🗑️ Console errors cleared"
        };

      case 'filter':
        if (request.filter) {
          monitor.updateFilters(request.filter);
        }
        return {
          success: true,
          message: "⚙️ Console filters updated",
          filters: monitor['filters']
        };

      case 'status':
        const recentErrors = monitor.getRecentErrors(5);
        return {
          success: true,
          active: monitor['isActive'],
          recentErrorsCount: recentErrors.length,
          totalErrorsCount: monitor['errors'].size,
          filters: monitor['filters'],
          summary: monitor['isActive'] 
            ? `✅ Monitoring active, ${recentErrors.length} recent errors`
            : "⏹️ Monitoring inactive"
        };

      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }
};
