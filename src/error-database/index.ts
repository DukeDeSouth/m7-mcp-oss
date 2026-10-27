/**
 * M7 v3.0 - Error Pattern Database
 * 
 * Main entry point for the Error Pattern Database system
 * Track AI mistakes, learn from corrections, provide preventive warnings
 */

import { ErrorStore } from './error-store.js';
import { ErrorMatcher, BUILT_IN_PATTERNS } from './error-matcher.js';
import {
  ErrorEntry,
  ErrorCorrection,
  ErrorPattern,
  ErrorContext,
  ErrorCategory,
  ErrorSeverity,
  ErrorSearchOptions,
  CaptureResult,
  MatchResult,
  PreventiveWarning,
  ErrorDatabaseConfig,
  DEFAULT_ERROR_DATABASE_CONFIG
} from './types.js';

// Re-export types
export * from './types.js';
export { ErrorStore } from './error-store.js';
export { ErrorMatcher, BUILT_IN_PATTERNS } from './error-matcher.js';

// ============================================
// ERROR DATABASE CLASS
// ============================================

export class ErrorDatabase {
  private store: ErrorStore;
  private matcher: ErrorMatcher;
  private config: ErrorDatabaseConfig;
  private initialized: boolean = false;
  
  constructor(config: Partial<ErrorDatabaseConfig> = {}) {
    this.config = { ...DEFAULT_ERROR_DATABASE_CONFIG, ...config };
    this.store = new ErrorStore(this.config);
    this.matcher = new ErrorMatcher(this.store, this.config);
  }
  
  /**
   * Initialize the Error Database system
   */
  async initialize(chromaUrl?: string): Promise<void> {
    if (this.initialized) return;
    
    await this.store.initialize();
    await this.matcher.initialize(chromaUrl);
    
    this.initialized = true;
  }
  
  // ============================================
  // ERROR CAPTURE
  // ============================================
  
  /**
   * Capture an AI mistake
   */
  async capture(params: {
    category: ErrorCategory;
    title: string;
    description: string;
    aiMistake: string;
    correctSolution: string;
    explanation: string;
    context?: ErrorContext;
    severity?: ErrorSeverity;
    projectId?: string;
    agentId?: string;
    tags?: string[];
  }): Promise<CaptureResult> {
    // Check if similar error exists
    const existing = await this.findSimilar(params.aiMistake);
    
    if (existing) {
      // Increment occurrence count
      await this.store.incrementOccurrence(existing.id);
      
      return {
        success: true,
        entryId: existing.id,
        message: `Updated existing error (${existing.occurrences + 1} occurrences)`
      };
    }
    
    // Create new error entry
    const entry: ErrorEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: params.category,
      title: params.title,
      description: params.description,
      context: params.context || {},
      aiMistake: params.aiMistake,
      correctSolution: params.correctSolution,
      explanation: params.explanation,
      severity: params.severity || this.inferSeverity(params.category),
      projectId: params.projectId || 'default',
      agentId: params.agentId,
      occurrences: 1,
      lastOccurrence: new Date(),
      firstOccurrence: new Date(),
      tags: params.tags || [],
      resolved: false,
      preventable: true
    };
    
    await this.store.addError(entry);
    
    // Try to learn a pattern from it
    if (this.config.autoLearnPatterns) {
      await this.matcher.learnFromError(entry);
    }
    
    return {
      success: true,
      entryId: entry.id,
      message: 'New error captured'
    };
  }
  
  /**
   * Record a correction for an error
   */
  async recordCorrection(params: {
    errorId: string;
    originalCode: string;
    correctedCode: string;
    correctedBy?: 'user' | 'ai' | 'system';
  }): Promise<{
    correctionId: string;
    patternLearned: boolean;
  }> {
    const correction: ErrorCorrection = {
      id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      errorId: params.errorId,
      originalCode: params.originalCode,
      correctedCode: params.correctedCode,
      correctionMethod: 'manual',
      confidence: 0.9,
      verified: params.correctedBy === 'user',
      correctedBy: params.correctedBy || 'user',
      correctedAt: new Date()
    };
    
    await this.store.addCorrection(correction);
    
    // Mark error as resolved
    await this.store.updateError(params.errorId, { resolved: true });
    
    // Try to learn pattern
    const error = this.store.getError(params.errorId);
    let patternLearned = false;
    
    if (error && this.config.autoLearnPatterns) {
      const pattern = await this.matcher.learnFromError(error);
      patternLearned = pattern !== null;
    }
    
    return {
      correctionId: correction.id,
      patternLearned
    };
  }
  
  // ============================================
  // ERROR MATCHING & WARNINGS
  // ============================================
  
  /**
   * Check code for potential errors
   */
  async check(code: string, filePath?: string): Promise<MatchResult> {
    if (!this.config.enableWarnings) {
      return {
        matched: false,
        patterns: [],
        warnings: [],
        confidence: 0
      };
    }
    
    return this.matcher.matchCode(code, filePath);
  }
  
  /**
   * Get warnings for code
   */
  async getWarnings(code: string, filePath?: string): Promise<PreventiveWarning[]> {
    const result = await this.check(code, filePath);
    return result.warnings;
  }
  
  /**
   * Format warnings as text
   */
  formatWarnings(warnings: PreventiveWarning[]): string {
    if (warnings.length === 0) {
      return '✅ No potential issues detected';
    }
    
    const lines: string[] = [];
    lines.push(`⚠️ ${warnings.length} potential issue(s) detected:\n`);
    
    for (const warning of warnings) {
      const icon = this.severityIcon(warning.severity);
      lines.push(`${icon} ${warning.title}`);
      lines.push(`   ${warning.message}`);
      lines.push(`   📍 ${warning.location.file}:${warning.location.line}`);
      if (warning.suggestedFix) {
        lines.push(`   💡 ${warning.suggestedFix}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  // ============================================
  // SEARCH & RETRIEVAL
  // ============================================
  
  /**
   * Search errors
   */
  search(options: ErrorSearchOptions) {
    return this.store.searchErrors(options);
  }
  
  /**
   * Get error by ID
   */
  getError(id: string): ErrorEntry | undefined {
    return this.store.getError(id);
  }
  
  /**
   * Find similar errors
   */
  private async findSimilar(mistake: string): Promise<ErrorEntry | null> {
    // Simple text matching for now
    const results = this.store.searchErrors({
      query: mistake.slice(0, 100),
      limit: 5
    });
    
    for (const entry of results.entries) {
      // Check if mistakes are similar enough
      if (this.similarity(entry.aiMistake, mistake) > 0.8) {
        return entry;
      }
    }
    
    return null;
  }
  
  /**
   * Simple string similarity
   */
  private similarity(a: string, b: string): number {
    const aWords = new Set(a.toLowerCase().split(/\s+/));
    const bWords = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...aWords].filter(x => bWords.has(x)));
    const union = new Set([...aWords, ...bWords]);
    
    return intersection.size / union.size;
  }
  
  // ============================================
  // STATISTICS
  // ============================================
  
  /**
   * Get error statistics
   */
  getStatistics(projectId?: string) {
    return this.store.getStatistics(projectId);
  }
  
  /**
   * Format statistics as text
   */
  formatStatistics(projectId?: string): string {
    const stats = this.getStatistics(projectId);
    
    const lines: string[] = [];
    lines.push('📊 Error Pattern Database Statistics');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push(`Total Errors: ${stats.totalErrors}`);
    lines.push(`Resolved: ${stats.resolvedErrors} (${Math.round(stats.resolvedErrors / Math.max(1, stats.totalErrors) * 100)}%)`);
    lines.push(`Patterns: ${stats.patternsCount}`);
    lines.push(`Avg Occurrences: ${stats.avgOccurrences.toFixed(1)}`);
    lines.push('');
    
    lines.push('📂 By Category:');
    for (const [category, count] of Object.entries(stats.byCategory)) {
      if (count > 0) {
        lines.push(`  ${category}: ${count}`);
      }
    }
    lines.push('');
    
    lines.push('⚡ By Severity:');
    for (const [severity, count] of Object.entries(stats.bySeverity)) {
      if (count > 0) {
        lines.push(`  ${this.severityIcon(severity as ErrorSeverity)} ${severity}: ${count}`);
      }
    }
    lines.push('');
    
    if (stats.topErrors.length > 0) {
      lines.push('🔝 Top Errors:');
      for (const error of stats.topErrors.slice(0, 5)) {
        lines.push(`  ${error.occurrences}x - ${error.title}`);
      }
    }
    
    return lines.join('\n');
  }
  
  // ============================================
  // PATTERN MANAGEMENT
  // ============================================
  
  /**
   * Get all patterns
   */
  getPatterns(): ErrorPattern[] {
    return this.matcher.getPatterns();
  }
  
  /**
   * Add custom pattern
   */
  async addPattern(pattern: Omit<ErrorPattern, 'id' | 'createdAt' | 'updatedAt'>): Promise<ErrorPattern> {
    return this.matcher.addPattern(pattern);
  }
  
  /**
   * Enable/disable pattern
   */
  async setPatternEnabled(id: string, enabled: boolean): Promise<void> {
    return this.matcher.setPatternEnabled(id, enabled);
  }
  
  /**
   * Report false positive
   */
  async reportFalsePositive(patternId: string): Promise<void> {
    return this.matcher.reportFalsePositive(patternId);
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  /**
   * Infer severity from category
   */
  private inferSeverity(category: ErrorCategory): ErrorSeverity {
    switch (category) {
      case 'security':
        return 'critical';
      case 'syntax':
      case 'type':
        return 'high';
      case 'logic':
      case 'api':
        return 'medium';
      default:
        return 'low';
    }
  }
  
  /**
   * Get severity icon
   */
  private severityIcon(severity: ErrorSeverity): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🔵';
      default: return '⚪';
    }
  }
  
  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: ErrorDatabase | null = null;

export function getErrorDatabase(config?: Partial<ErrorDatabaseConfig>): ErrorDatabase {
  if (!instance) {
    instance = new ErrorDatabase(config);
  }
  return instance;
}

export default ErrorDatabase;

