/**
 * M7 v3.9 - Smart Scope Scanner
 * 
 * Модуль для сканирования кодовой базы и корректировки оценки scope задачи.
 * v3.9.0: Добавлен tiered caching для оптимизации производительности.
 * 
 * @author M7 AI Assistant
 * @version 3.9.0
 * @date 2026-01-26
 */

// Types
export type {
  ScopeContext,
  TaskKeywords,
  PatternMatch,
  FileStats,
  LineStats,
  ScopeRecommendation,
  ScanOptions
} from './types.js';

export type { ScanPattern } from './patterns.js';

export { DEFAULT_SCAN_OPTIONS } from './types.js';

// Patterns
export {
  TECHNOLOGY_PATTERNS,
  KEYWORD_TO_PATTERNS,  // deprecated: use LLM pattern selection
  EXTENSION_TO_TECH,
  getPatternsForKeywords,
  getPatternsForExtension,
  getPatternById  // v3.5.1: for LLM-selected patterns
} from './patterns.js';

// Scanner
export {
  ScopeScanner,
  getScopeScanner,
  scanProjectScope
} from './scopeScanner.js';

// v3.9: Cache
export {
  ScopeCache,
  getScopeCache
} from './scopeCache.js';
