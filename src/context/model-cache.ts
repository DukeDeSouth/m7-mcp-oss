/**
 * M7 v3.1 - Model Cache
 * 
 * In-memory cache for API models with TTL
 */

import { AvailableModels } from './types.js';

/**
 * Cache for available models with TTL
 */
export class ModelCache {
  private cache: AvailableModels | null = null;
  private lastFetch: number = 0;
  private ttl: number;

  /**
   * Create new ModelCache
   * @param ttlMs Time-to-live in milliseconds (default: 24 hours)
   */
  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttl = ttlMs;
  }

  /**
   * Get cached models (null if expired or not set)
   */
  get(): AvailableModels | null {
    if (this.isExpired()) {
      return null;
    }
    return this.cache;
  }

  /**
   * Set models in cache
   */
  set(models: AvailableModels): void {
    this.cache = models;
    this.lastFetch = Date.now();
  }

  /**
   * Check if cache is expired
   */
  isExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.lastFetch > this.ttl;
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache = null;
    this.lastFetch = 0;
  }

  /**
   * Get cache age in milliseconds
   */
  getAge(): number {
    if (!this.lastFetch) return Infinity;
    return Date.now() - this.lastFetch;
  }

  /**
   * Get cache stats
   */
  getStats(): { cached: boolean; age: number; ttl: number; expiresIn: number } {
    const age = this.getAge();
    return {
      cached: this.cache !== null,
      age,
      ttl: this.ttl,
      expiresIn: Math.max(0, this.ttl - age),
    };
  }
}

