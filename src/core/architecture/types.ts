/**
 * M7 v3.6 - Architecture Context Types
 * 
 * Типы для автоматического поиска архитектурного контекста
 */

// ============================================
// SEARCH RESULT
// ============================================

export interface SearchResult {
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Code snippet */
  snippet: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** Keyword that matched */
  keyword: string;
}

// ============================================
// SIMILAR PATTERN
// ============================================

export interface SimilarPattern {
  /** Pattern name/description */
  pattern: string;
  /** Where pattern is used */
  locations: SearchResult[];
  /** How many times used */
  usageCount: number;
}

// ============================================
// RECOMMENDATION
// ============================================

export interface ArchitectureRecommendation {
  /** Should extend existing code? */
  extendExisting: boolean;
  /** Should create new code? */
  createNew: boolean;
  /** Reasoning for recommendation */
  reasoning: string;
  /** Suggested files to look at */
  suggestedFiles: string[];
}

// ============================================
// ARCHITECTURE CONTEXT
// ============================================

export interface ArchitectureContext {
  /** Extracted keywords from task */
  keywords: string[];
  /** Found similar code in project */
  existingImplementations: SearchResult[];
  /** Detected patterns */
  similarPatterns: SimilarPattern[];
  /** Recommendation for AI */
  recommendation: ArchitectureRecommendation;
  /** Warnings for AI */
  warnings: string[];
  /** Time taken for analysis (ms) */
  analysisTimeMs: number;
}

// ============================================
// CONFIG
// ============================================

export interface ArchitectureContextConfig {
  /** Max results to return */
  maxResults: number;
  /** Max keywords to search */
  maxKeywords: number;
  /** Min relevance score */
  minRelevance: number;
  /** Timeout for ripgrep (ms) */
  ripgrepTimeoutMs: number;
  /** Use Knowledge Graph first */
  preferKnowledgeGraph: boolean;
}

export const DEFAULT_ARCHITECTURE_CONTEXT_CONFIG: ArchitectureContextConfig = {
  maxResults: 5,
  maxKeywords: 5,
  minRelevance: 0.5,
  ripgrepTimeoutMs: 2000,
  preferKnowledgeGraph: true
};
