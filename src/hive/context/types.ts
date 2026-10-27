/**
 * M7 v3.10 Context Window Types
 * 
 * Types for context window management and truncation.
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

// ============================================
// MODEL LIMITS
// ============================================

export interface ModelLimits {
  /** Model identifier */
  model: string;
  /** Maximum context window size in tokens */
  maxContextTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Recommended safe limit (leave headroom for response) */
  safeInputLimit: number;
}

export const MODEL_LIMITS: Record<string, ModelLimits> = {
  // Anthropic flagship — Claude Opus 4.6 (Feb 2026, 200K/1M beta)
  'claude-opus-4-6': {
    model: 'claude-opus-4-6',
    maxContextTokens: 200000,
    maxOutputTokens: 128000,
    safeInputLimit: 180000,
  },
  // OpenAI models
  'gpt-4o': {
    model: 'gpt-4o',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    safeInputLimit: 100000,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    safeInputLimit: 100000,
  },
  'gpt-4-turbo': {
    model: 'gpt-4-turbo',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    safeInputLimit: 120000,
  },
  'gpt-4-1106-preview': {
    model: 'gpt-4-1106-preview',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    safeInputLimit: 120000,
  },
  'gpt-4': {
    model: 'gpt-4',
    maxContextTokens: 8192,
    maxOutputTokens: 4096,
    safeInputLimit: 6000,
  },
  'gpt-3.5-turbo': {
    model: 'gpt-3.5-turbo',
    maxContextTokens: 16385,
    maxOutputTokens: 4096,
    safeInputLimit: 12000,
  },
  
  // Anthropic models
  'claude-3-opus-20240229': {
    model: 'claude-3-opus-20240229',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    safeInputLimit: 180000,
  },
  'claude-3-sonnet-20240229': {
    model: 'claude-3-sonnet-20240229',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    safeInputLimit: 180000,
  },
  'claude-sonnet-4-20250514': {
    model: 'claude-sonnet-4-20250514',
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    safeInputLimit: 180000,
  },
  'claude-3-haiku-20240307': {
    model: 'claude-3-haiku-20240307',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    safeInputLimit: 180000,
  },
  'claude-3-5-sonnet-20241022': {
    model: 'claude-3-5-sonnet-20241022',
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    safeInputLimit: 180000,
  },
};

// Default for unknown models
export const DEFAULT_MODEL_LIMITS: ModelLimits = {
  model: 'unknown',
  maxContextTokens: 8000,
  maxOutputTokens: 2000,
  safeInputLimit: 6000,
};

// ============================================
// TRUNCATION STRATEGIES
// ============================================

export type TruncationStrategy = 
  | 'tail'           // Keep end, remove beginning (chat history)
  | 'head'           // Keep beginning, remove end (document analysis)
  | 'middle'         // Keep beginning and end, remove middle
  | 'smart'          // Intelligent truncation based on content type
  | 'summarize';     // Summarize truncated content (requires LLM call)

export interface TruncationConfig {
  /** Strategy to use when truncating */
  strategy: TruncationStrategy;
  /** Target token count after truncation */
  targetTokens: number;
  /** Preserve system prompt (never truncate) */
  preserveSystemPrompt: boolean;
  /** Minimum tokens to preserve at start */
  minHeadTokens: number;
  /** Minimum tokens to preserve at end */
  minTailTokens: number;
  /** Add truncation marker (e.g., "... [truncated] ...") */
  addMarker: boolean;
  /** Marker text */
  markerText: string;
}

export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  strategy: 'smart',
  targetTokens: 0, // Will be calculated based on model
  preserveSystemPrompt: true,
  minHeadTokens: 500,
  minTailTokens: 2000,
  addMarker: true,
  markerText: '\n\n... [content truncated for context limit] ...\n\n',
};

// ============================================
// CONTEXT ANALYSIS
// ============================================

export interface ContextAnalysis {
  /** Total tokens in input */
  totalTokens: number;
  /** Tokens in system prompt */
  systemPromptTokens: number;
  /** Tokens in user messages */
  userMessageTokens: number;
  /** Tokens in assistant messages (history) */
  assistantTokens: number;
  /** Tokens in code blocks */
  codeTokens: number;
  /** Model being used */
  model: string;
  /** Model limits */
  limits: ModelLimits;
  /** Is context within safe limits */
  isWithinLimits: boolean;
  /** Tokens over limit (0 if within limits) */
  tokensOverLimit: number;
  /** Utilization percentage (0-100) */
  utilizationPercent: number;
  /** Estimated response headroom */
  responseHeadroom: number;
}

export interface ContextSection {
  /** Section type */
  type: 'system' | 'user' | 'assistant' | 'code' | 'context';
  /** Content */
  content: string;
  /** Token count */
  tokens: number;
  /** Can this section be truncated? */
  canTruncate: boolean;
  /** Priority (lower = more important, keep) */
  priority: number;
}

// ============================================
// GUARD RESULT
// ============================================

export interface ContextGuardResult {
  /** Was truncation needed? */
  truncated: boolean;
  /** Original token count */
  originalTokens: number;
  /** Final token count */
  finalTokens: number;
  /** Tokens removed */
  tokensRemoved: number;
  /** Strategy used */
  strategy: TruncationStrategy;
  /** Final content */
  content: string;
  /** Warnings (if any) */
  warnings: string[];
  /** Analysis before truncation */
  analysis: ContextAnalysis;
}

// ============================================
// CONTEXT GUARD CONFIG
// ============================================

export interface ContextGuardConfig {
  /** Enable context guard */
  enabled: boolean;
  /** Auto-truncate when over limit */
  autoTruncate: boolean;
  /** Warn when utilization exceeds this percentage */
  warningThreshold: number;
  /** Error when utilization exceeds this percentage */
  errorThreshold: number;
  /** Default truncation config */
  truncation: Partial<TruncationConfig>;
  /** Log context usage */
  logUsage: boolean;
}

export const DEFAULT_CONTEXT_GUARD_CONFIG: ContextGuardConfig = {
  enabled: true,
  autoTruncate: true,
  warningThreshold: 80,
  errorThreshold: 95,
  truncation: {},
  logUsage: true,
};

// ============================================
// CODE CONTEXT TYPES (v3.8.0 legacy)
// ============================================

/**
 * Options for code context extraction
 */
export interface CodeContextOptions {
  /** Project root path */
  projectPath: string;
  /** Maximum total tokens for context */
  maxTotalTokens: number;
  /** Maximum files to include */
  maxFiles: number;
  /** Maximum lines per file */
  maxLinesPerFile: number;
  /** Search depth for relevant files */
  searchDepth: number;
  /** Include file paths only (no content) */
  pathsOnly: boolean;
  /** File extensions to include (e.g., ['.ts', '.js']) */
  includeExtensions: string[];
  /** Patterns to exclude (dirs and files) */
  excludePatterns: string[];
}

export const DEFAULT_CODE_CONTEXT_OPTIONS: CodeContextOptions = {
  projectPath: '',
  maxTotalTokens: 4000,
  maxFiles: 10,
  maxLinesPerFile: 100,
  searchDepth: 3,
  pathsOnly: false,
  includeExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'],
  excludePatterns: ['node_modules', 'dist', 'build', '.git', '__pycache__', 'vendor', '*.d.ts', '*.min.js'],
};

/**
 * A relevant file found during context search
 */
export interface RelevantFile {
  /** Absolute path to file */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** File language/extension */
  language: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** Code snippet */
  snippet: string;
  /** Line range in original file */
  lines: {
    start: number;
    end: number;
  };
  /** Keywords found in this file */
  matchedKeywords?: string[];
  /** Number of keyword matches */
  matchCount?: number;
}

/**
 * Complete code context for prompt injection
 */
export interface CodeContext {
  /** Relevant files found */
  files: RelevantFile[];
  /** Keywords used for search */
  keywords: string[];
  /** Total lines of code */
  totalLines: number;
  /** Estimated token count */
  totalTokens: number;
  /** Formatted markdown for prompt */
  markdown: string;
  /** Search duration in ms */
  searchDurationMs: number;
}

export const EMPTY_CODE_CONTEXT: CodeContext = {
  files: [],
  keywords: [],
  totalLines: 0,
  totalTokens: 0,
  markdown: '',
  searchDurationMs: 0,
};
