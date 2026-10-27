import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[Journal]');
/**
 * M7 v3.10 Journal System
 * 
 * Система журналирования ошибок и фич.
 * v3.9.0: Async buffer + batch flush для оптимизации I/O.
 * v3.10.0: Atomic writes + backup rotation for crash safety.
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

import path from 'path';
import { promises as fs } from 'fs';
import { getProjectPath } from '../core/utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../core/utils/atomicWrite.js';

export interface ErrorEntry {
  id: string;
  error: string;
  context: string;
  solution?: string;
  timestamp: Date;
  fixed: boolean;
  category: 'compilation' | 'runtime' | 'logic' | 'performance' | 'security';
  type?: string; // Дополнительное поле для совместимости
  description?: string; // Дополнительное поле для совместимости  
  tags?: string[]; // Дополнительное поле для совместимости
  severity?: 'low' | 'medium' | 'high' | 'critical'; // Для enterpriseDashboard
}

export interface FeatureEntry {
  id: string;
  name: string;
  description: string;
  implementation: string;
  lessons: string[];
  patterns: string[];
  complexity: 'light' | 'medium' | 'heavy';
  timestamp: Date;
}

// v3.9: Pending write types
interface PendingWrite {
  type: 'error' | 'feature';
  data: ErrorEntry | FeatureEntry;
  timestamp: number;
}

export class JournalSystem {
  private readonly dataPath: string;
  private readonly errorsFile: string;
  private readonly featuresFile: string;
  
  // Smart Error Prevention: Cache for critical errors
  private criticalErrorCache: Map<string, { count: number; lastSeen: Date; entry: ErrorEntry }> = new Map();
  private cacheLastUpdate: Date = new Date();
  private readonly CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // v3.9: Async buffer for batched writes
  private pendingWrites: PendingWrite[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_DELAY_MS = 1000; // 1 second debounce
  private readonly MAX_PENDING_WRITES = 20; // Force flush if too many pending
  private isFlushingInProgress = false;

  constructor(projectPath?: string) {
    // Используем проектную папку .m7/ вместо глобальной ~/.m7-mcp
    const basePath = projectPath || getProjectPath();
    this.dataPath = path.join(basePath, '.m7');
    
    this.errorsFile = path.join(this.dataPath, 'errors.json');
    this.featuresFile = path.join(this.dataPath, 'features.json');
  }

  // ============================================
  // v3.9: ASYNC BUFFER MANAGEMENT
  // ============================================

  /**
   * v3.9: Schedule a flush with debounce
   */
  private scheduleFlush(): void {
    // Force flush if too many pending
    if (this.pendingWrites.length >= this.MAX_PENDING_WRITES) {
      this.flushPendingWrites();
      return;
    }
    
    // Debounce: reset timer on each new write
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.flushTimer = setTimeout(() => {
      this.flushPendingWrites();
    }, this.FLUSH_DELAY_MS);
  }

  /**
   * v3.9: Flush all pending writes to disk
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.isFlushingInProgress || this.pendingWrites.length === 0) {
      return;
    }
    
    this.isFlushingInProgress = true;
    this.flushTimer = null;
    
    // Take snapshot of pending writes
    const writesToProcess = [...this.pendingWrites];
    this.pendingWrites = [];
    
    try {
      // Group by type
      const errors: ErrorEntry[] = [];
      const features: FeatureEntry[] = [];
      
      for (const write of writesToProcess) {
        if (write.type === 'error') {
          errors.push(write.data as ErrorEntry);
        } else {
          features.push(write.data as FeatureEntry);
        }
      }
      
      // Batch write errors
      if (errors.length > 0) {
        const existingErrors = await this.loadErrors();
        existingErrors.push(...errors);
        await this.saveErrorsDirect(existingErrors);
      }
      
      // Batch write features
      if (features.length > 0) {
        const existingFeatures = await this.loadFeatures();
        existingFeatures.push(...features);
        await this.saveFeaturesDirect(existingFeatures);
      }
      
      log.debug(`v3.9: Flushed ${writesToProcess.length} entries (${errors.length} errors, ${features.length} features)`);
    } catch (error) {
      // On error, put writes back for retry
      log.warn(`v3.9: Flush failed, will retry:`, error);
      this.pendingWrites = [...writesToProcess, ...this.pendingWrites];
    } finally {
      this.isFlushingInProgress = false;
    }
  }

  /**
   * v3.9: Force flush before shutdown
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushPendingWrites();
  }

  /**
   * v3.10: Atomic save with backup rotation
   */
  private async saveErrorsDirect(errors: ErrorEntry[]): Promise<void> {
    const result = await atomicWriteJSON(this.errorsFile, errors, {
      maxBackups: 3,
      createBackup: true,
    });
    
    if (!result.success) {
      throw new Error(`Failed to save errors: ${result.error}`);
    }
    
    if (result.backupCreated) {
      log.debug(`Errors backup created: ${result.backupPath}`);
    }
  }

  /**
   * v3.10: Atomic save with backup rotation
   */
  private async saveFeaturesDirect(features: FeatureEntry[]): Promise<void> {
    const result = await atomicWriteJSON(this.featuresFile, features, {
      maxBackups: 3,
      createBackup: true,
    });
    
    if (!result.success) {
      throw new Error(`Failed to save features: ${result.error}`);
    }
    
    if (result.backupCreated) {
      log.debug(`Features backup created: ${result.backupPath}`);
    }
  }

  async logError(error: Omit<ErrorEntry, 'id' | 'timestamp'>): Promise<string> {
    // Smart Error Prevention: Check for similar errors first
    if (error.severity === 'critical' || error.severity === 'high') {
      const similarCheck = await this.checkSimilarError(error.error, error.context);
      
      if (similarCheck.isSimilar && similarCheck.matchedError) {
        log.warn(`⚠️  SIMILAR ERROR DETECTED (${similarCheck.similarity}% match)
Previous occurrence: ${similarCheck.matchedError.timestamp}
Suggestion: ${similarCheck.suggestion}`);
      }
    }
    
    const errorEntry: ErrorEntry = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...error
    };

    // v3.9: Add to pending writes instead of immediate save
    this.pendingWrites.push({
      type: 'error',
      data: errorEntry,
      timestamp: Date.now()
    });
    this.scheduleFlush();

    return errorEntry.id;
  }

  async logFeature(feature: Omit<FeatureEntry, 'id' | 'timestamp'>): Promise<string> {
    const featureEntry: FeatureEntry = {
      id: `feature_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...feature
    };

    // v3.9: Add to pending writes instead of immediate save
    this.pendingWrites.push({
      type: 'feature',
      data: featureEntry,
      timestamp: Date.now()
    });
    this.scheduleFlush();

    return featureEntry.id;
  }

  async getErrors(type?: string): Promise<ErrorEntry[]> {
    const errors = await this.loadErrors();
    
    // Safety check - ensure errors is an array
    if (!Array.isArray(errors)) {
      log.debug('JournalSystem] loadErrors returned non-array:', typeof errors);
      return [];
    }
    
    if (type) {
      return errors.filter(error => 
        error.type?.toLowerCase().includes(type.toLowerCase()) ||
        error.description?.toLowerCase().includes(type.toLowerCase()) ||
        error.tags?.some(tag => tag.toLowerCase().includes(type.toLowerCase()))
      );
    }
    
    return errors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async getFeatures(name?: string): Promise<FeatureEntry[]> {
    const features = await this.loadFeatures();
    
    // Safety check - ensure features is an array
    if (!Array.isArray(features)) {
      log.debug('JournalSystem] loadFeatures returned non-array:', typeof features);
      return [];
    }
    
    if (name) {
      return features.filter(feature =>
        feature.name.toLowerCase().includes(name.toLowerCase()) ||
        feature.description.toLowerCase().includes(name.toLowerCase()) ||
        feature.patterns.some(pattern => pattern.toLowerCase().includes(name.toLowerCase()))
      );
    }
    
    return features.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async searchByTag(tag: string): Promise<{ errors: ErrorEntry[], features: FeatureEntry[] }> {
    const errors = await this.getErrors();
    const features = await this.getFeatures();
    
    const filteredErrors = errors.filter(error =>
      error.tags?.some(t => t.toLowerCase().includes(tag.toLowerCase()))
    );
    
    const filteredFeatures = features.filter(feature =>
      feature.patterns.some(p => p.toLowerCase().includes(tag.toLowerCase()))
    );
    
    return { errors: filteredErrors, features: filteredFeatures };
  }

  async getStats(): Promise<{
    totalErrors: number;
    totalFeatures: number;
    errorsByType: Record<string, number>;
    featuresByComplexity: Record<string, number>;
    recentActivity: Array<{ type: 'error' | 'feature', item: ErrorEntry | FeatureEntry }>;
  }> {
    const errors = await this.loadErrors();
    const features = await this.loadFeatures();
    
    // Error statistics
    const errorsByType: Record<string, number> = {};
    errors.forEach(error => {
      errorsByType[error.type || ''] = (errorsByType[error.type || ''] || 0) + 1;
    });
    
    // Feature statistics
    const featuresByComplexity: Record<string, number> = {};
    features.forEach(feature => {
      featuresByComplexity[feature.complexity] = (featuresByComplexity[feature.complexity] || 0) + 1;
    });
    
    // Recent activity (last 10 items)
    const allItems = [
      ...errors.map(e => ({ type: 'error' as const, item: e, timestamp: e.timestamp })),
      ...features.map(f => ({ type: 'feature' as const, item: f, timestamp: f.timestamp }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const recentActivity = allItems.slice(0, 10).map(({ type, item }) => ({ type, item }));
    
    return {
      totalErrors: errors.length,
      totalFeatures: features.length,
      errorsByType,
      featuresByComplexity,
      recentActivity
    };
  }

  async findByType(type: string): Promise<ErrorEntry[]> {
    const errors = await this.getErrors();
    return errors.filter(error => 
      error.category?.toLowerCase().includes(type.toLowerCase()) ||
      error.error?.toLowerCase().includes(type.toLowerCase()) ||
      error.context?.toLowerCase().includes(type.toLowerCase())
    );
  }

  async findByTag(tag: string): Promise<ErrorEntry[]> {
    const errors = await this.getErrors();
    return errors.filter(error => 
      error.category?.toLowerCase().includes(tag.toLowerCase()) ||
      error.error?.toLowerCase().includes(tag.toLowerCase())
    );
  }

  async getErrorsByType(): Promise<Record<string, number>> {
    const errors = await this.getErrors();
    const errorsByType: Record<string, number> = {};
    
    errors.forEach(error => {
      const category = error.category || 'unknown';
      errorsByType[category] = (errorsByType[category] || 0) + 1;
    });
    
    return errorsByType;
  }

  // Smart Error Prevention: Get top critical errors from last N days
  async getTopCriticalErrors(days: number = 7, limit: number = 5): Promise<Array<{
    error: ErrorEntry;
    frequency: number;
    lastOccurrence: Date;
  }>> {
    const errors = await this.loadErrors();
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // Filter critical errors within timeframe
    const criticalErrors = errors.filter(e => 
      (e.severity === 'critical' || e.severity === 'high') && 
      new Date(e.timestamp) > cutoffDate
    );
    
    // Count frequencies
    const errorFrequency = new Map<string, { count: number; lastError: ErrorEntry }>();
    
    criticalErrors.forEach(error => {
      const key = this.getErrorKey(error);
      const existing = errorFrequency.get(key);
      
      if (!existing || new Date(error.timestamp) > new Date(existing.lastError.timestamp)) {
        errorFrequency.set(key, {
          count: (existing?.count || 0) + 1,
          lastError: error
        });
      }
    });
    
    // Sort by frequency and return top N
    return Array.from(errorFrequency.entries())
      .map(([_, data]) => ({
        error: data.lastError,
        frequency: data.count,
        lastOccurrence: new Date(data.lastError.timestamp)
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  // Smart Error Prevention: Check if error is similar to recent critical errors
  async checkSimilarError(errorText: string, context: string): Promise<{
    isSimilar: boolean;
    matchedError?: ErrorEntry;
    suggestion?: string;
    similarity?: number;
  }> {
    const topErrors = await this.getTopCriticalErrors();
    
    for (const { error } of topErrors) {
      const similarity = this.calculateSimilarity(
        errorText.toLowerCase(),
        error.error.toLowerCase()
      );
      
      if (similarity > 0.7) { // 70% threshold
        return {
          isSimilar: true,
          matchedError: error,
          suggestion: error.solution || 'Check error journal for previous solutions',
          similarity: Math.round(similarity * 100)
        };
      }
    }
    
    return { isSimilar: false };
  }

  // Helper: Simple string similarity (Jaccard index)
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  // Helper: Generate consistent error key
  private getErrorKey(error: ErrorEntry): string {
    return `${error.category}:${error.error.substring(0, 50)}`;
  }

  private async loadErrors(): Promise<ErrorEntry[]> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
      
      // v3.10: Use safe read with automatic backup recovery
      const result = await safeReadJSON<ErrorEntry[] | { errors: ErrorEntry[] }>(this.errorsFile);
      
      if (result.recoveredFrom) {
        log.warn(`Errors recovered from backup: ${result.recoveredFrom}`);
      }
      
      if (result.data) {
        // Handle both array format and { errors: [] } object format
        if (Array.isArray(result.data)) {
          return result.data;
        }
        if (result.data && Array.isArray((result.data as any).errors)) {
          return (result.data as any).errors;
        }
      }
      
      return [];
    } catch (error) {
      // File doesn't exist or is invalid, return empty array
      return [];
    }
  }

  private async saveErrors(errors: ErrorEntry[]): Promise<void> {
    // v3.9: Delegate to direct save (for backward compatibility)
    await this.saveErrorsDirect(errors);
  }

  private async loadFeatures(): Promise<FeatureEntry[]> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
      
      // v3.10: Use safe read with automatic backup recovery
      const result = await safeReadJSON<FeatureEntry[] | { features: FeatureEntry[] }>(this.featuresFile);
      
      if (result.recoveredFrom) {
        log.warn(`Features recovered from backup: ${result.recoveredFrom}`);
      }
      
      if (result.data) {
        // Handle both array format and { features: [] } object format
        if (Array.isArray(result.data)) {
          return result.data;
        }
        if (result.data && Array.isArray((result.data as any).features)) {
          return (result.data as any).features;
        }
      }
      
      return [];
    } catch (error) {
      // File doesn't exist or is invalid, return empty array
      return [];
    }
  }

  private async saveFeatures(features: FeatureEntry[]): Promise<void> {
    // v3.9: Delegate to direct save (for backward compatibility)
    await this.saveFeaturesDirect(features);
  }
} 