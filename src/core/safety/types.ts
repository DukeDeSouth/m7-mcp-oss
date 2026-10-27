/**
 * Safety Pipeline — Type Definitions
 *
 * Heterogeneous safety verification for LLM outputs.
 * Deterministic, non-neural, formally-verifiable rules.
 */

// ── Severity & Actions ──

export type TrapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TrapAction = 'block' | 'warn' | 'log';
export type PipelineStage = 'input_trap' | 'intent_verification' | 'consistency' | 'output_trap';

// ── TRAP Definitions ──

export interface SurfacePattern {
  pattern: RegExp;
  weight: number;
  description: string;
}

export interface TrapDefinition {
  id: string;
  class: TrapClass;
  name: string;
  severity: TrapSeverity;
  action: TrapAction;
  surfacePatterns: SurfacePattern[];
  discriminate: (analysis: InputAnalysis) => boolean;
  description: string;
}

export type TrapClass =
  | 'PERSONA_OVERRIDE'
  | 'ENCODING_BYPASS'
  | 'CONTEXT_MANIPULATION'
  | 'LOGICAL_TRICK'
  | 'TECHNICAL_EXPLOIT'
  | 'AUTHORITY_CLAIM'
  | 'OUTPUT_HARMFUL';

// ── Input Analysis ──

export interface InputAnalysis {
  raw: string;
  normalized: string;
  tokens: string[];
  hasPersonaInstruction: boolean;
  hasConstraintRemoval: boolean;
  hasCapabilityExpansion: boolean;
  hasEncodedContent: boolean;
  hasAuthorityBypss: boolean;
  hasHypotheticalFrame: boolean;
  hasCompletionAttack: boolean;
  encodingType?: 'base64' | 'hex' | 'unicode' | 'rot13' | 'unknown';
  decodedContent?: string;
  perplexityEstimate: 'normal' | 'suspicious' | 'anomalous';
  language: string;
}

// ── TRAP Detection Results ──

export interface TrapVerdict {
  triggered: boolean;
  trapId: string;
  trapClass: TrapClass;
  severity: TrapSeverity;
  action: TrapAction;
  confidence: number;
  evidence: string[];
}

export interface ScanResult {
  blocked: boolean;
  action: TrapAction;
  verdicts: TrapVerdict[];
  analysisTimeMs: number;
  trapsEvaluated: number;
}

// ── Intent Graph ──

export type TopicSensitivity = 'safe' | 'sensitive' | 'dangerous';
export type TargetType = 'self' | 'others' | 'systems' | 'general';
export type RequestType = 'information' | 'action' | 'creation' | 'modification' | 'meta';

export interface CoreIntent {
  requestType: RequestType;
  topicSensitivity: TopicSensitivity;
  target: TargetType;
  personaModification: boolean;
  constraintRemoval: boolean;
  escalationScore: number;
}

export interface IntentNode {
  tag: string;
  props: Record<string, any>;
  children?: IntentNode[];
}

export interface IntentGraph {
  root: IntentNode;
  core: CoreIntent;
}

// ── Intent Verification ──

export interface SafetyRuleResult {
  violated: boolean;
  ruleId: string;
  reason?: string;
  evidence?: string[];
}

export interface VerificationResult {
  passed: boolean;
  action: TrapAction | 'pass';
  violations: SafetyRuleResult[];
  verificationTimeMs: number;
}

// ── Pipeline ──

export interface PipelineResult {
  action: 'pass' | 'block' | 'warn';
  stage?: PipelineStage;
  response?: string;
  details?: ScanResult | VerificationResult;
  metadata: {
    trapsEvaluated: number;
    intentExtracted: boolean;
    verificationPassed: boolean;
    totalTimeMs: number;
    blockedBy?: string;
  };
}
