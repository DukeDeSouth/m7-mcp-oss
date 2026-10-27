/**
 * M7 Hive Debate Engine - Types
 * 
 * Real LLM-powered debate system for multi-agent deliberation.
 * Replaces the fake keyword-based consensus with actual AI reasoning.
 * 
 * @version 1.0.0
 */

import { DynamicAgent, DynamicAgentProposal } from '../intelligence/types.js';

// ============================================================================
// DEBATE CONFIGURATION
// ============================================================================

export interface DebateConfig {
  /** Maximum debate rounds before stopping */
  maxRounds: number;
  
  /** Convergence threshold (0-1). Stop if reached. */
  convergenceThreshold: number;
  
  /** Budget cap as multiplier of initial proposal cost. 2.0 = up to 2x proposal cost for debate. */
  budgetCapMultiplier: number;
  
  /** Model for critique calls (economy recommended) */
  critiqueModel: string;
  
  /** Model for refinement calls (economy recommended) */
  refineModel: string;
  
  /** Model for convergence checks */
  convergenceModel: string;
}

export const DEFAULT_DEBATE_CONFIG: DebateConfig = {
  maxRounds: 3,
  convergenceThreshold: 0.8,
  budgetCapMultiplier: 3.0,
  critiqueModel: 'claude-opus-4-6',                // Flagship Anthropic — Opus 4.7 not yet broadly available
  refineModel: 'gpt-5.5',                          // Flagship OpenAI — GPQA 93.6%, ARC-AGI 85%
  convergenceModel: 'claude-opus-4-6',             // Flagship — best available reasoning
};

// ============================================================================
// CRITIQUE TYPES
// ============================================================================

/** Possible verdicts for a critique */
export type CritiqueVerdict = 'CONFIRM' | 'REFINE' | 'CONTEST' | 'INSUFFICIENT';

/** LLM-generated critique of one agent's proposal by another */
export interface LLMCritique {
  /** Agent performing the critique */
  criticAgent: DynamicAgent;
  
  /** Agent whose proposal is being critiqued */
  targetAgent: DynamicAgent;
  
  /** Calibrated verdict */
  verdict: CritiqueVerdict;
  
  /** Reasoning behind the verdict */
  reasoning: string;
  
  /** Critic's confidence in this evaluation (0-1) */
  confidence: number;
  
  /** Specific suggested changes (for REFINE verdict) */
  suggestedChanges?: string;
}

// ============================================================================
// ROUND RESULTS
// ============================================================================

export interface DebateRoundResult {
  /** Round number (1-indexed) */
  roundNumber: number;
  
  /** All critiques generated in this round */
  critiques: LLMCritique[];
  
  /** Proposals after refinement */
  refinedProposals: DynamicAgentProposal[];
  
  /** Convergence score (0-1) */
  convergenceScore: number;
  
  /** Direction of movement */
  convergenceDirection: 'converging' | 'diverging' | 'stable';
  
  /** Cost of this round in USD */
  cost: number;
  
  /** Latency of this round in ms */
  latencyMs: number;
}

// ============================================================================
// DEBATE RESULT
// ============================================================================

/** Why the debate stopped */
export type DebateStopReason = 'converged' | 'max_rounds' | 'budget_cap';

export interface DebateResult {
  /** All debate rounds */
  rounds: DebateRoundResult[];
  
  /** Final proposals after all debate rounds */
  finalProposals: DynamicAgentProposal[];
  
  /** Whether convergence was reached */
  converged: boolean;
  
  /** Final convergence score */
  convergenceScore: number;
  
  /** Total rounds executed */
  totalRounds: number;
  
  /** Total API cost for debate */
  totalCost: number;
  
  /** Total tokens used in debate */
  totalTokens: number;
  
  /** Total latency in ms */
  totalLatencyMs: number;
  
  /** Why debate stopped */
  stoppedReason: DebateStopReason;
}
