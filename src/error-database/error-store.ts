/**
 * M7 v3.0 - Error Store
 * 
 * SQLite-based storage for error patterns with fast querying
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ErrorEntry,
  ErrorCorrection,
  ErrorPattern,
  ErrorSearchOptions,
  ErrorSearchResult,
  ErrorCategory,
  ErrorSeverity,
  ErrorDatabaseConfig,
  DEFAULT_ERROR_DATABASE_CONFIG
} from './types.js';

// ============================================
// IN-MEMORY STORE (SQLite-like interface)
// ============================================

// Note: Using in-memory store for now to avoid native dependency issues
// Can be replaced with better-sqlite3 later for production use

interface Store {
  errors: Map<string, ErrorEntry>;
  corrections: Map<string, ErrorCorrection>;
  patterns: Map<string, ErrorPattern>;
}

export class ErrorStore {
  private store: Store;
  private config: ErrorDatabaseConfig;
  private dataPath: string;
  private initialized: boolean = false;
  
  constructor(config: Partial<ErrorDatabaseConfig> = {}) {
    this.config = { ...DEFAULT_ERROR_DATABASE_CONFIG, ...config };
    this.dataPath = this.config.sqlitePath.replace('~', process.env.HOME || '');
    
    this.store = {
      errors: new Map(),
      corrections: new Map(),
      patterns: new Map()
    };
  }
  
  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Ensure directory exists
    const dir = path.dirname(this.dataPath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Load existing data
    await this.load();
    
    this.initialized = true;
  }
  
  // ============================================
  // ERROR CRUD
  // ============================================
  
  /**
   * Add a new error entry
   */
  async addError(error: ErrorEntry): Promise<void> {
    this.store.errors.set(error.id, error);
    await this.save();
  }
  
  /**
   * Get error by ID
   */
  getError(id: string): ErrorEntry | undefined {
    return this.store.errors.get(id);
  }
  
  /**
   * Update error entry
   */
  async updateError(id: string, updates: Partial<ErrorEntry>): Promise<void> {
    const existing = this.store.errors.get(id);
    if (existing) {
      this.store.errors.set(id, { ...existing, ...updates });
      await this.save();
    }
  }
  
  /**
   * Delete error entry
   */
  async deleteError(id: string): Promise<void> {
    this.store.errors.delete(id);
    await this.save();
  }
  
  /**
   * Search errors with filters
   */
  searchErrors(options: ErrorSearchOptions): ErrorSearchResult {
    let results = Array.from(this.store.errors.values());
    
    // Apply filters
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(e =>
        e.title.toLowerCase().includes(query) ||
        e.description.toLowerCase().includes(query) ||
        e.aiMistake.toLowerCase().includes(query) ||
        e.correctSolution.toLowerCase().includes(query)
      );
    }
    
    if (options.category) {
      results = results.filter(e => e.category === options.category);
    }
    
    if (options.severity) {
      results = results.filter(e => e.severity === options.severity);
    }
    
    if (options.projectId) {
      results = results.filter(e => e.projectId === options.projectId);
    }
    
    if (options.agentId) {
      results = results.filter(e => e.agentId === options.agentId);
    }
    
    if (options.resolved !== undefined) {
      results = results.filter(e => e.resolved === options.resolved);
    }
    
    if (options.preventable !== undefined) {
      results = results.filter(e => e.preventable === options.preventable);
    }
    
    if (options.dateFrom) {
      results = results.filter(e => e.lastOccurrence >= options.dateFrom!);
    }
    
    if (options.dateTo) {
      results = results.filter(e => e.lastOccurrence <= options.dateTo!);
    }
    
    // Sort
    const sortBy = options.sortBy || 'date';
    const sortOrder = options.sortOrder || 'desc';
    
    results.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = a.lastOccurrence.getTime() - b.lastOccurrence.getTime();
          break;
        case 'occurrences':
          comparison = a.occurrences - b.occurrences;
          break;
        case 'severity':
          const severityOrder: Record<ErrorSeverity, number> = {
            critical: 4,
            high: 3,
            medium: 2,
            low: 1
          };
          comparison = severityOrder[a.severity] - severityOrder[b.severity];
          break;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // Paginate
    const offset = options.offset || 0;
    const limit = options.limit || 20;
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);
    
    return {
      entries: paginatedResults,
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Increment error occurrence count
   */
  async incrementOccurrence(id: string): Promise<void> {
    const error = this.store.errors.get(id);
    if (error) {
      error.occurrences++;
      error.lastOccurrence = new Date();
      await this.save();
    }
  }
  
  // ============================================
  // CORRECTION CRUD
  // ============================================
  
  /**
   * Add a correction
   */
  async addCorrection(correction: ErrorCorrection): Promise<void> {
    this.store.corrections.set(correction.id, correction);
    await this.save();
  }
  
  /**
   * Get corrections for an error
   */
  getCorrectionsForError(errorId: string): ErrorCorrection[] {
    return Array.from(this.store.corrections.values())
      .filter(c => c.errorId === errorId);
  }
  
  /**
   * Get all corrections
   */
  getAllCorrections(): ErrorCorrection[] {
    return Array.from(this.store.corrections.values());
  }
  
  // ============================================
  // PATTERN CRUD
  // ============================================
  
  /**
   * Add a pattern
   */
  async addPattern(pattern: ErrorPattern): Promise<void> {
    this.store.patterns.set(pattern.id, pattern);
    await this.save();
  }
  
  /**
   * Get pattern by ID
   */
  getPattern(id: string): ErrorPattern | undefined {
    return this.store.patterns.get(id);
  }
  
  /**
   * Get all patterns
   */
  getAllPatterns(): ErrorPattern[] {
    return Array.from(this.store.patterns.values());
  }
  
  /**
   * Get enabled patterns
   */
  getEnabledPatterns(): ErrorPattern[] {
    return Array.from(this.store.patterns.values())
      .filter(p => p.enabled);
  }
  
  /**
   * Update pattern
   */
  async updatePattern(id: string, updates: Partial<ErrorPattern>): Promise<void> {
    const existing = this.store.patterns.get(id);
    if (existing) {
      this.store.patterns.set(id, { ...existing, ...updates, updatedAt: new Date() });
      await this.save();
    }
  }
  
  /**
   * Delete pattern
   */
  async deletePattern(id: string): Promise<void> {
    this.store.patterns.delete(id);
    await this.save();
  }
  
  /**
   * Increment pattern match count
   */
  async incrementPatternMatch(id: string, prevented: boolean = false): Promise<void> {
    const pattern = this.store.patterns.get(id);
    if (pattern) {
      pattern.matchCount++;
      if (prevented) pattern.preventionCount++;
      await this.save();
    }
  }
  
  // ============================================
  // STATISTICS
  // ============================================
  
  /**
   * Get error statistics
   */
  getStatistics(projectId?: string): {
    totalErrors: number;
    resolvedErrors: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    topErrors: Array<{ id: string; title: string; occurrences: number }>;
    patternsCount: number;
    avgOccurrences: number;
  } {
    let errors = Array.from(this.store.errors.values());
    
    if (projectId) {
      errors = errors.filter(e => e.projectId === projectId);
    }
    
    const byCategory: Record<ErrorCategory, number> = {
      syntax: 0,
      type: 0,
      import: 0,
      api: 0,
      logic: 0,
      style: 0,
      security: 0,
      performance: 0,
      compatibility: 0,
      other: 0
    };
    
    const bySeverity: Record<ErrorSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    
    let totalOccurrences = 0;
    
    for (const error of errors) {
      byCategory[error.category]++;
      bySeverity[error.severity]++;
      totalOccurrences += error.occurrences;
    }
    
    const topErrors = [...errors]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10)
      .map(e => ({
        id: e.id,
        title: e.title,
        occurrences: e.occurrences
      }));
    
    return {
      totalErrors: errors.length,
      resolvedErrors: errors.filter(e => e.resolved).length,
      byCategory,
      bySeverity,
      topErrors,
      patternsCount: this.store.patterns.size,
      avgOccurrences: errors.length > 0 ? totalOccurrences / errors.length : 0
    };
  }
  
  // ============================================
  // PERSISTENCE
  // ============================================
  
  private async load(): Promise<void> {
    const jsonPath = this.dataPath.replace('.db', '.json');
    
    try {
      const data = await fs.promises.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore errors
      if (parsed.errors) {
        for (const error of parsed.errors) {
          error.lastOccurrence = new Date(error.lastOccurrence);
          error.firstOccurrence = new Date(error.firstOccurrence);
          this.store.errors.set(error.id, error);
        }
      }
      
      // Restore corrections
      if (parsed.corrections) {
        for (const correction of parsed.corrections) {
          correction.correctedAt = new Date(correction.correctedAt);
          this.store.corrections.set(correction.id, correction);
        }
      }
      
      // Restore patterns
      if (parsed.patterns) {
        for (const pattern of parsed.patterns) {
          pattern.createdAt = new Date(pattern.createdAt);
          pattern.updatedAt = new Date(pattern.updatedAt);
          this.store.patterns.set(pattern.id, pattern);
        }
      }
    } catch {
      // No existing data
    }
  }
  
  private async save(): Promise<void> {
    const jsonPath = this.dataPath.replace('.db', '.json');
    
    const data = {
      errors: Array.from(this.store.errors.values()),
      corrections: Array.from(this.store.corrections.values()),
      patterns: Array.from(this.store.patterns.values())
    };
    
    await fs.promises.writeFile(jsonPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    this.store.errors.clear();
    this.store.corrections.clear();
    this.store.patterns.clear();
    await this.save();
  }
  
  /**
   * Get store size
   */
  getSize(): { errors: number; corrections: number; patterns: number } {
    return {
      errors: this.store.errors.size,
      corrections: this.store.corrections.size,
      patterns: this.store.patterns.size
    };
  }
}

export default ErrorStore;

