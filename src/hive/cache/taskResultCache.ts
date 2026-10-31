import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TaskResultCache]');

/**
 * M7 Hive - Task Result Cache
 * 
 * Caches task execution results to avoid redundant API calls.
 * Uses semantic similarity matching for cache hits.
 * 
 * @version 3.9.0
 */

import { createHash } from 'crypto';

/**
 * Cached task result
 */
export interface CachedResult {
  taskHash: string;
  taskDescription: string;
  agentRole: string;
  result: string;
  success: boolean;
  tokensUsed: number;
  cachedAt: Date;
  hitCount: number;
  keywords: string[];
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalTokensSaved: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

/**
 * Cache options
 */
export interface TaskCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  similarityThreshold?: number;  // 0-1, minimum similarity for cache hit
}

const DEFAULT_OPTIONS: Required<TaskCacheOptions> = {
  maxEntries: 100,
  ttlMs: 30 * 60 * 1000,  // 30 minutes
  similarityThreshold: 0.7
};

/**
 * Task Result Cache
 * 
 * Provides caching for Hive task results with semantic similarity matching.
 */
export class TaskResultCache {
  private cache: Map<string, CachedResult> = new Map();
  private options: Required<TaskCacheOptions>;
  private stats: { hits: number; misses: number; tokensSaved: number };
  
  constructor(options: TaskCacheOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stats = { hits: 0, misses: 0, tokensSaved: 0 };
  }
  
  /**
   * Generate hash for task description
   */
  private hashTask(description: string): string {
    const normalized = description
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return createHash('md5').update(normalized).digest('hex');
  }
  
  /**
   * Extract keywords from task description
   */
  private extractKeywords(description: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and',
      'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not',
      'only', 'own', 'same', 'than', 'too', 'very', 'just', 'that', 'this',
      'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
      'why', 'all', 'each', 'every', 'any', 'some', 'no', 'none', 'one', 'two'
    ]);
    
    return description
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
  }
  
  /**
   * Calculate similarity between two keyword sets (Jaccard similarity)
   */
  private calculateSimilarity(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    let intersection = 0;
    for (const word of set1) {
      if (set2.has(word)) intersection++;
    }
    
    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }
  
  /**
   * Check if entry is expired
   */
  private isExpired(entry: CachedResult): boolean {
    return Date.now() - entry.cachedAt.getTime() > this.options.ttlMs;
  }
  
  /**
   * Clean expired entries
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [hash, entry] of this.cache) {
      if (now - entry.cachedAt.getTime() > this.options.ttlMs) {
        this.cache.delete(hash);
      }
    }
  }
  
  /**
   * Evict oldest entries if over limit
   */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.options.maxEntries) return;
    
    // Sort by cachedAt and remove oldest
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].cachedAt.getTime() - b[1].cachedAt.getTime());
    
    const toRemove = entries.slice(0, this.cache.size - this.options.maxEntries);
    for (const [hash] of toRemove) {
      this.cache.delete(hash);
    }
  }
  
  /**
   * Get cached result for task (exact or similar match)
   */
  get(taskDescription: string, agentRole?: string): CachedResult | null {
    this.cleanExpired();
    
    const taskHash = this.hashTask(taskDescription);
    const taskKeywords = this.extractKeywords(taskDescription);
    
    // Try exact match first
    const exactMatch = this.cache.get(taskHash);
    if (exactMatch && !this.isExpired(exactMatch)) {
      if (!agentRole || exactMatch.agentRole === agentRole) {
        exactMatch.hitCount++;
        this.stats.hits++;
        this.stats.tokensSaved += exactMatch.tokensUsed;
        log.debug(`[TaskCache] 🎯 Exact cache hit for: ${taskDescription.substring(0, 40)}...`);
        return exactMatch;
      }
    }
    
    // Try semantic similarity match
    let bestMatch: CachedResult | null = null;
    let bestSimilarity = 0;
    
    for (const entry of this.cache.values()) {
      if (this.isExpired(entry)) continue;
      if (agentRole && entry.agentRole !== agentRole) continue;
      
      const similarity = this.calculateSimilarity(taskKeywords, entry.keywords);
      if (similarity > bestSimilarity && similarity >= this.options.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }
    
    if (bestMatch) {
      bestMatch.hitCount++;
      this.stats.hits++;
      this.stats.tokensSaved += bestMatch.tokensUsed;
      log.debug(`[TaskCache] 🔍 Similar cache hit (${Math.round(bestSimilarity * 100)}%): ${taskDescription.substring(0, 40)}...`);
      return bestMatch;
    }
    
    this.stats.misses++;
    return null;
  }
  
  /**
   * Store task result in cache
   */
  set(
    taskDescription: string,
    agentRole: string,
    result: string,
    success: boolean,
    tokensUsed: number
  ): void {
    // Only cache successful results
    if (!success) return;
    
    this.cleanExpired();
    this.evictIfNeeded();
    
    const taskHash = this.hashTask(taskDescription);
    const keywords = this.extractKeywords(taskDescription);
    
    const entry: CachedResult = {
      taskHash,
      taskDescription,
      agentRole,
      result: result.substring(0, 5000), // Limit cached result size
      success,
      tokensUsed,
      cachedAt: new Date(),
      hitCount: 0,
      keywords
    };
    
    this.cache.set(taskHash, entry);
    log.debug(`[TaskCache] 💾 Cached result for: ${taskDescription.substring(0, 40)}...`);
  }
  
  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.cleanExpired();
    
    const entries = Array.from(this.cache.values());
    const dates = entries.map(e => e.cachedAt);
    
    return {
      totalEntries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.hits + this.stats.misses > 0 
        ? this.stats.hits / (this.stats.hits + this.stats.misses) 
        : 0,
      totalTokensSaved: this.stats.tokensSaved,
      oldestEntry: dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null,
      newestEntry: dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
    };
  }
  
  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    log.debug(`[TaskCache] 🗑️ Cache cleared`);
  }
  
  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
let globalTaskCache: TaskResultCache | null = null;

/**
 * Get global task result cache
 */
export function getTaskResultCache(): TaskResultCache {
  if (!globalTaskCache) {
    globalTaskCache = new TaskResultCache();
    log.debug(`[TaskCache] 🗄️ Initialized task result cache`);
  }
  return globalTaskCache;
}

/**
 * Reset global task cache (for testing)
 */
export function resetTaskResultCache(): void {
  if (globalTaskCache) {
    globalTaskCache.clear();
  }
  globalTaskCache = null;
}
