/**
 * M7 v3.9 - Scope Scanner Cache
 * 
 * Tiered caching для результатов сканирования scope.
 * Оптимизация: O(1) cache lookup вместо full filesystem scan.
 * 
 * @author M7 AI Assistant
 * @version 3.9.0
 * @date 2026-01-26
 */

import { ScopeContext } from './types.js';
import { ScanPatternId } from '../intelligence/intentClassifier.js';

// ============================================
// CACHE TYPES
// ============================================

interface CacheEntry {
  result: ScopeContext;
  timestamp: number;
  hitCount: number;
}

interface CacheKey {
  projectPath: string;
  patternsHash: string;
  extensionsHash: string;
}

// ============================================
// SCOPE CACHE CLASS
// ============================================

export class ScopeCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly DEFAULT_TTL_MS = 60000; // 1 minute
  private readonly MAX_CACHE_SIZE = 50;
  
  // Statistics
  private hits = 0;
  private misses = 0;

  /**
   * Получить закешированный результат
   */
  get(
    projectPath: string,
    patterns?: ScanPatternId[],
    extensions?: string[],
    ttlMs: number = this.DEFAULT_TTL_MS
  ): ScopeContext | null {
    const key = this.buildKey(projectPath, patterns, extensions);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    // Update hit count
    entry.hitCount++;
    this.hits++;
    
    return entry.result;
  }

  /**
   * Сохранить результат в кеш
   */
  set(
    projectPath: string,
    patterns: ScanPatternId[] | undefined,
    extensions: string[] | undefined,
    result: ScopeContext
  ): void {
    const key = this.buildKey(projectPath, patterns, extensions);
    
    // LRU eviction if cache is full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }
    
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hitCount: 0
    });
  }

  /**
   * Проверить свежесть кеша для проекта
   */
  isFresh(projectPath: string, maxAgeMs: number = this.DEFAULT_TTL_MS): boolean {
    // Check if any entry for this project is fresh
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(projectPath) && Date.now() - entry.timestamp < maxAgeMs) {
        return true;
      }
    }
    return false;
  }

  /**
   * Инвалидировать кеш для проекта
   */
  invalidate(projectPath: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(projectPath)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Очистить весь кеш
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Получить статистику кеша
   */
  getStats(): { 
    size: number; 
    hits: number; 
    misses: number; 
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Построить ключ кеша
   */
  private buildKey(
    projectPath: string,
    patterns?: ScanPatternId[],
    extensions?: string[]
  ): string {
    const patternsHash = patterns?.sort().join(',') || '';
    const extensionsHash = extensions?.sort().join(',') || '';
    return `${projectPath}|${patternsHash}|${extensionsHash}`;
  }

  /**
   * LRU eviction - удалить наименее используемые записи
   */
  private evictLRU(): void {
    // Find entry with lowest hitCount and oldest timestamp
    let oldestKey: string | null = null;
    let lowestScore = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      // Score = hitCount * 1000 - age (lower is worse)
      const age = Date.now() - entry.timestamp;
      const score = entry.hitCount * 1000 - age;
      
      if (score < lowestScore) {
        lowestScore = score;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// ============================================
// SINGLETON
// ============================================

let cacheInstance: ScopeCache | null = null;

/**
 * Получить singleton кеша
 */
export function getScopeCache(): ScopeCache {
  if (!cacheInstance) {
    cacheInstance = new ScopeCache();
  }
  return cacheInstance;
}

/**
 * Хелпер: быстрый хеш строки (djb2)
 */
export function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
