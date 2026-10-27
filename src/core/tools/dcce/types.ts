/**
 * DCCE — Dual-Channel Content Envelope
 * 
 * Protocol for delivering AI-generated content through two channels:
 * - Human View: 3-5 sentences, casual tone, no structure
 * - AI View: structured JSON with full reasoning and metadata
 * 
 * AI remains AI. No identity masking.
 * 
 * @version 0.1.0
 * @spec https://github.com/dcce/spec (planned)
 */

// ============================================
// DCCE ENVELOPE
// ============================================

export interface DCCEEnvelope {
  /** Protocol version (semver) */
  dcceVersion: '0.1';
  
  /** Unique envelope ID */
  id: string;
  
  /** ISO timestamp */
  timestamp: string;
  
  /** Content type this envelope wraps */
  contentType: DCCEContentType;
  
  /** The two channels */
  channels: {
    /** Human-readable summary (3-5 sentences, no structure) */
    human: string;
    /** Structured AI-generated details */
    ai: Record<string, unknown>;
  };
  
  /** Content origin metadata */
  provenance: DCCEProvenance;
  
  /** Policy hints for renderers */
  policyHints?: DCCEPolicyHints;
}

export type DCCEContentType = 
  | 'pr_description'
  | 'issue_description'
  | 'changelog'
  | 'rfc'
  | 'review_comment'
  | 'documentation'
  | 'generic';

export interface DCCEProvenance {
  /** Who created this content */
  actor: 'human' | 'ai' | 'hybrid';
  /** Tool that generated it (optional) */
  tool?: string;
  /** Model used (optional) */
  model?: string;
  /** Timestamp of generation */
  generatedAt: string;
}

export interface DCCEPolicyHints {
  /** Max character length for Human View */
  maxHumanLength?: number;
  /** Max sentence count for Human View */
  maxHumanSentences?: number;
  /** Required AI View fields */
  requiredAiFields?: string[];
  /** Confidentiality level */
  confidentiality?: 'public' | 'internal' | 'restricted';
}

// ============================================
// DCCE MODE
// ============================================

export type DCCEMode = 'full' | 'lite' | 'none';

// ============================================
// VALIDATION RESULT
// ============================================

export interface DCCEValidationResult {
  valid: boolean;
  errors: DCCEValidationError[];
  warnings: DCCEValidationWarning[];
}

export interface DCCEValidationError {
  field: string;
  message: string;
  code: string;
}

export interface DCCEValidationWarning {
  field: string;
  message: string;
  code: string;
}

// ============================================
// RENDER OPTIONS
// ============================================

export type DCCERenderFormat = 'github' | 'markdown' | 'json' | 'plain';

export interface DCCERenderOptions {
  format: DCCERenderFormat;
  /** Show AI View (default: true for json, collapsed for github) */
  showAiView?: boolean;
  /** Include provenance info */
  showProvenance?: boolean;
}

// ============================================
// POLICY PRESET
// ============================================

export interface DCCEPolicyPreset {
  name: string;
  description: string;
  policyHints: DCCEPolicyHints;
  /** AI-style patterns to warn about in Human View */
  humanViewAntiPatterns: RegExp[];
  /** Required fields in AI View per content type */
  aiViewRequirements: Partial<Record<DCCEContentType, string[]>>;
}
