/**
 * M7 Hive - Robust JSON Parser Types
 * 
 * Types for the robust JSON parsing pipeline:
 * Extract -> Repair -> Recover -> Validate
 */

// ============================================================================
// EXTRACTION TYPES
// ============================================================================

export type ExtractionSource = 'markdown_json' | 'markdown_any' | 'inline' | 'raw' | 'none';

export interface ExtractionResult {
  /** Whether JSON was found */
  found: boolean;
  /** Extracted JSON string (or null if not found) */
  json: string | null;
  /** Source of the extraction */
  source: ExtractionSource;
  /** Warnings generated during extraction */
  warnings: string[];
  /** Original content for debugging */
  originalLength: number;
}

// ============================================================================
// REPAIR TYPES
// ============================================================================

export type RepairType = 
  | 'trailing_comma'
  | 'line_comment'
  | 'block_comment'
  | 'smart_quote_double'
  | 'smart_quote_single'
  | 'unescaped_newline'
  | 'unescaped_tab'
  | 'typo_true'
  | 'typo_false'
  | 'typo_null'
  | 'missing_quote'
  | 'other';

export interface RepairChange {
  /** Type of repair applied */
  type: RepairType;
  /** Position in original string */
  position: number;
  /** What was found */
  original: string;
  /** What it was changed to */
  replacement: string;
}

export interface RepairResult {
  /** Repaired JSON string */
  repaired: string;
  /** List of changes made */
  changes: RepairChange[];
  /** Whether any repairs were made */
  wasRepaired: boolean;
  /** Confidence that repairs are correct (0-1) */
  confidence: number;
}

// ============================================================================
// TRUNCATION RECOVERY TYPES
// ============================================================================

export interface TruncationAnalysis {
  /** Whether truncation was detected */
  isTruncated: boolean;
  /** Number of unclosed braces { */
  unclosedBraces: number;
  /** Number of unclosed brackets [ */
  unclosedBrackets: number;
  /** Whether we're inside an unclosed string */
  unclosedString: boolean;
  /** Position where truncation likely occurred */
  truncationPosition: number;
}

export interface RecoveryResult {
  /** Recovered JSON string */
  recovered: string;
  /** Analysis of truncation */
  analysis: TruncationAnalysis;
  /** Whether recovery was attempted */
  recoveryAttempted: boolean;
  /** Whether the recovered JSON is structurally valid */
  structureIntact: boolean;
  /** Parts that were added to close the structure */
  addedParts: string[];
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationError {
  /** Path to the invalid field */
  path: string[];
  /** Error message */
  message: string;
  /** Expected type */
  expected?: string;
  /** Received value */
  received?: unknown;
}

export interface ValidationResult<T> {
  /** Whether validation passed */
  valid: boolean;
  /** Validated and normalized data (or null if invalid) */
  data: T | null;
  /** Validation errors */
  errors: ValidationError[];
  /** Fields that were set to defaults */
  defaultsApplied: string[];
}

// ============================================================================
// MAIN PARSE RESULT
// ============================================================================

export interface RobustParseResult<T = unknown> {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed and validated data (or null if failed) */
  data: T | null;
  /** Raw content that was parsed */
  raw: string;
  
  // Pipeline stages info
  extraction: {
    source: ExtractionSource;
    warnings: string[];
  };
  repair: {
    wasRepaired: boolean;
    changes: RepairChange[];
  };
  recovery: {
    wasTruncated: boolean;
    recoveryAttempted: boolean;
  };
  validation: {
    errors: ValidationError[];
    defaultsApplied: string[];
  };
  
  /** Overall confidence in the result (0-1) */
  confidence: number;
  /** Error message if parsing failed */
  error?: string;
  /** Processing time in ms */
  processingTime: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface RobustParseConfig {
  /** Enable extraction from markdown blocks */
  extractFromMarkdown: boolean;
  /** Enable JSON repair */
  enableRepair: boolean;
  /** Enable truncation recovery */
  enableRecovery: boolean;
  /** Maximum content length to process */
  maxContentLength: number;
  /** Timeout for parsing in ms */
  timeout: number;
  /** Minimum confidence to consider success */
  minConfidence: number;
}

export const DEFAULT_PARSE_CONFIG: RobustParseConfig = {
  extractFromMarkdown: true,
  enableRepair: true,
  enableRecovery: true,
  maxContentLength: 100_000,
  timeout: 5000,
  minConfidence: 0.3
};
