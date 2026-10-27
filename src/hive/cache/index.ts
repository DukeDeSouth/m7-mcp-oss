/**
 * M7 Hive Cache Module
 * 
 * Exports task result caching for Hive optimization.
 */

export {
  TaskResultCache,
  getTaskResultCache,
  resetTaskResultCache,
  type CachedResult,
  type CacheStats,
  type TaskCacheOptions
} from './taskResultCache.js';
