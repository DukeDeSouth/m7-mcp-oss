/**
 * M7 v3.0 - Error Pattern Database Types
 * 
 * Track AI mistakes, learn from corrections, provide preventive warnings
 */

// ============================================
// ERROR ENTRY TYPES
// ============================================

export type ErrorCategory =
  | 'syntax'           // Syntax errors in generated code
  | 'type'             // Type mismatches, wrong types
  | 'import'           // Wrong import paths, missing imports
  | 'api'              // Wrong API usage, deprecated methods
  | 'logic'            // Logical errors, wrong conditions
  | 'style'            // Style violations
  | 'security'         // Security issues
  | 'performance'      // Performance anti-patterns
  | 'compatibility'    // Browser/Node compatibility issues
  | 'other';

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ErrorEntry {
  id: string;
  
  // Error identification
  category: ErrorCategory;
  subcategory?: string;
  errorCode?: string;
  
  // Error details
  title: string;
  description: string;
  
  // Context
  context: ErrorContext;
  
  // AI mistake details
  aiMistake: string;          // What AI generated (wrong)
  correctSolution: string;    // What it should have been
  explanation: string;        // Why it was wrong
  
  // Metadata
  severity: ErrorSeverity;
  projectId: string;
  agentId?: string;
  
  // Statistics
  occurrences: number;
  lastOccurrence: Date;
  firstOccurrence: Date;
  
  // Learning
  pattern?: string;           // Extracted pattern for matching
  embedding?: number[];       // Vector embedding for semantic search
  tags: string[];
  
  // Resolution
  resolved: boolean;
  resolutionTime?: number;    // Time to fix in ms
  preventable: boolean;       // Could this be prevented?
}

export interface ErrorContext {
  file?: string;
  line?: number;
  column?: number;
  
  // Code context
  codeSnippet?: string;
  surroundingCode?: string;
  
  // Request context
  userQuery?: string;
  aiResponse?: string;
  
  // Environment
  language?: string;
  framework?: string;
  dependencies?: string[];
}

// ============================================
// ERROR CORRECTION
// ============================================

export interface ErrorCorrection {
  id: string;
  errorId: string;
  
  // Correction details
  originalCode: string;
  correctedCode: string;
  diff?: string;
  
  // Method
  correctionMethod: 'manual' | 'auto-fix' | 'suggestion';
  
  // Quality
  confidence: number;
  verified: boolean;
  
  // Metadata
  correctedBy: 'user' | 'ai' | 'system';
  correctedAt: Date;
  
  // Learning extraction
  extractedRule?: string;
  ruleConfidence?: number;
}

// ============================================
// ERROR PATTERN (for matching)
// ============================================

export interface ErrorPattern {
  id: string;
  
  // Pattern identification
  name: string;
  description: string;
  category: ErrorCategory;
  
  // Matching
  matchType: 'exact' | 'regex' | 'semantic' | 'ast';
  pattern: string;
  
  // Prevention
  preventiveWarning: string;
  suggestedFix?: string;
  
  // Statistics
  matchCount: number;
  preventionCount: number;
  falsePositiveCount: number;
  
  // Quality
  confidence: number;
  enabled: boolean;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  source: 'learned' | 'manual' | 'imported';
}

// ============================================
// WARNING TYPES
// ============================================

export interface PreventiveWarning {
  id: string;
  patternId: string;
  
  // Warning content
  title: string;
  message: string;
  severity: ErrorSeverity;
  
  // Context
  matchedCode: string;
  location: {
    file: string;
    line: number;
    column: number;
  };
  
  // Related
  similarErrors: string[];  // IDs of similar past errors
  suggestedFix?: string;
  
  // Confidence
  confidence: number;
  
  // User interaction
  dismissed: boolean;
  dismissedAt?: Date;
  dismissReason?: string;
}

// ============================================
// STATISTICS
// ============================================

export interface ErrorStatistics {
  projectId: string;
  period: 'day' | 'week' | 'month' | 'all';
  
  // Counts
  totalErrors: number;
  resolvedErrors: number;
  preventedErrors: number;
  
  // By category
  byCategory: Record<ErrorCategory, number>;
  bySeverity: Record<ErrorSeverity, number>;
  
  // Trends
  errorRate: number;           // Errors per 100 generations
  resolutionRate: number;      // % of resolved errors
  preventionRate: number;      // % of prevented errors
  avgResolutionTime: number;   // Average time to fix
  
  // Top issues
  topErrors: Array<{
    errorId: string;
    title: string;
    occurrences: number;
  }>;
  
  // Learning metrics
  patternsLearned: number;
  rulesActive: number;
  falsePositiveRate: number;
  
  // Time series
  timeline: Array<{
    date: Date;
    errors: number;
    prevented: number;
  }>;
}

export interface AgentErrorStats {
  agentId: string;
  agentName: string;
  
  totalErrors: number;
  errorRate: number;
  commonMistakes: Array<{
    category: ErrorCategory;
    count: number;
  }>;
  
  improvement: number; // % improvement over time
}

// ============================================
// DATABASE SCHEMA
// ============================================

export interface ErrorDatabaseSchema {
  // Main tables
  errors: ErrorEntry[];
  corrections: ErrorCorrection[];
  patterns: ErrorPattern[];
  warnings: PreventiveWarning[];
  
  // Statistics cache
  statistics: ErrorStatistics[];
  agentStats: AgentErrorStats[];
}

// ============================================
// CONFIGURATION
// ============================================

export interface ErrorDatabaseConfig {
  enabled: boolean;
  
  // Storage
  sqlitePath: string;
  chromaCollection: string;
  
  // Capture settings
  autoCapture: boolean;
  captureThreshold: ErrorSeverity;
  
  // Warning settings
  enableWarnings: boolean;
  warningThreshold: number;  // Minimum confidence to show warning
  maxWarningsPerFile: number;
  
  // Learning settings
  autoLearnPatterns: boolean;
  minOccurrencesForPattern: number;
  patternConfidenceThreshold: number;
  
  // Retention
  retentionDays: number;
  maxEntries: number;
  
  // Statistics
  statisticsRefreshInterval: number; // minutes
}

export const DEFAULT_ERROR_DATABASE_CONFIG: ErrorDatabaseConfig = {
  enabled: true,
  
  sqlitePath: '~/.m7/errors.db',
  chromaCollection: 'm7_error_patterns',
  
  autoCapture: true,
  captureThreshold: 'low',
  
  enableWarnings: true,
  warningThreshold: 0.7,
  maxWarningsPerFile: 10,
  
  autoLearnPatterns: true,
  minOccurrencesForPattern: 3,
  patternConfidenceThreshold: 0.8,
  
  retentionDays: 365,
  maxEntries: 100000,
  
  statisticsRefreshInterval: 60
};

// ============================================
// SEARCH & QUERY
// ============================================

export interface ErrorSearchOptions {
  query?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  projectId?: string;
  agentId?: string;
  
  dateFrom?: Date;
  dateTo?: Date;
  
  resolved?: boolean;
  preventable?: boolean;
  
  limit?: number;
  offset?: number;
  
  sortBy?: 'date' | 'occurrences' | 'severity';
  sortOrder?: 'asc' | 'desc';
}

export interface ErrorSearchResult {
  entries: ErrorEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================
// API RESPONSES
// ============================================

export interface CaptureResult {
  success: boolean;
  entryId?: string;
  patternMatched?: string;
  similarErrors?: ErrorEntry[];
  message: string;
}

export interface MatchResult {
  matched: boolean;
  patterns: ErrorPattern[];
  warnings: PreventiveWarning[];
  confidence: number;
}

