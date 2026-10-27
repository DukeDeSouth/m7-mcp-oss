/**
 * M7 Hive Consensus System - Types
 * 
 * Defines types for agent debates, weighted voting, and consensus building.
 */

import { AgentType, AgentProposal } from '../types/agent.js';

// ============================================================================
// AGENT EXPERTISE
// ============================================================================

/**
 * Domain expertise weights for each agent type
 */
export interface AgentExpertise {
  agentType: AgentType;
  domains: {
    [domain: string]: number; // 0-1 weight
  };
  overallWeight: number; // 0-1
  historicalAccuracy: number; // 0-1, updated over time
}

/**
 * Default expertise configuration
 */
export const DEFAULT_EXPERTISE: Record<AgentType, AgentExpertise> = {
  research: {
    agentType: 'research',
    domains: {
      requirements: 0.9,
      analysis: 0.9,
      documentation: 0.8,
      alternatives: 0.85,
      architecture: 0.6,
      security: 0.5,
      performance: 0.5,
      testing: 0.4
    },
    overallWeight: 0.8,
    historicalAccuracy: 0.75
  },
  implementation: {
    agentType: 'implementation',
    domains: {
      coding: 0.95,
      architecture: 0.7,
      requirements: 0.6,
      testing: 0.65,
      performance: 0.6,
      security: 0.5,
      documentation: 0.5,
      analysis: 0.5
    },
    overallWeight: 0.85,
    historicalAccuracy: 0.8
  },
  architecture: {
    agentType: 'architecture',
    domains: {
      architecture: 0.95,
      design: 0.9,
      scalability: 0.85,
      patterns: 0.9,
      requirements: 0.7,
      performance: 0.7,
      security: 0.6,
      coding: 0.5
    },
    overallWeight: 0.85,
    historicalAccuracy: 0.8
  },
  security: {
    agentType: 'security',
    domains: {
      security: 0.95,
      authentication: 0.9,
      authorization: 0.9,
      encryption: 0.85,
      vulnerabilities: 0.9,
      compliance: 0.8,
      architecture: 0.6,
      coding: 0.5
    },
    overallWeight: 0.9,
    historicalAccuracy: 0.85
  },
  testing: {
    agentType: 'testing',
    domains: {
      testing: 0.95,
      quality: 0.9,
      coverage: 0.9,
      automation: 0.85,
      edge_cases: 0.85,
      requirements: 0.7,
      coding: 0.6,
      documentation: 0.5
    },
    overallWeight: 0.8,
    historicalAccuracy: 0.8
  },
  performance: {
    agentType: 'performance',
    domains: {
      performance: 0.95,
      optimization: 0.9,
      scalability: 0.85,
      profiling: 0.85,
      caching: 0.8,
      architecture: 0.65,
      coding: 0.6,
      testing: 0.5
    },
    overallWeight: 0.85,
    historicalAccuracy: 0.8
  },
  techsafety: {
    agentType: 'techsafety',
    domains: {
      safety: 0.95,
      patterns: 0.9,
      antipatterns: 0.9,
      best_practices: 0.85,
      risks: 0.85,
      security: 0.7,
      architecture: 0.65,
      coding: 0.6
    },
    overallWeight: 0.85,
    historicalAccuracy: 0.8
  }
};

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Types of conflicts between proposals
 */
export type ConflictType = 
  | 'approach'           // Different high-level approaches
  | 'technology'         // Different technology choices
  | 'architecture'       // Different architectural patterns
  | 'risk_assessment'    // Different risk evaluations
  | 'priority'           // Different priority ordering
  | 'implementation';    // Different implementation details

/**
 * Detected conflict between proposals
 */
export interface Conflict {
  id: string;
  type: ConflictType;
  severity: 'minor' | 'moderate' | 'major' | 'blocking';
  description: string;
  agents: AgentType[];            // Agents involved
  positions: ConflictPosition[];  // Each agent's position
  commonGround?: string;          // Any agreement found
  resolution?: ConflictResolution;
}

/**
 * An agent's position on a conflict
 */
export interface ConflictPosition {
  agentId: AgentType;
  stance: string;
  reasoning: string;
  confidence: number;
  evidence?: string[];
}

/**
 * Resolution of a conflict
 */
export interface ConflictResolution {
  method: 'weighted_vote' | 'expertise_override' | 'synthesis' | 'escalate' | 'defer';
  outcome: string;
  winningPosition?: AgentType;
  synthesizedSolution?: string;
  confidence: number;
  dissent?: {
    agentId: AgentType;
    reason: string;
  }[];
}

// ============================================================================
// VOTING
// ============================================================================

/**
 * Weighted vote from an agent
 */
export interface WeightedVote {
  voterId: AgentType;
  votedFor: AgentType;
  weight: number;           // Calculated from expertise
  confidence: number;       // Voter's confidence
  reasoning: string;
  rankings?: {              // Optional ranked choice
    agentId: AgentType;
    rank: number;
    score: number;
  }[];
}

/**
 * Result of a voting round
 */
export interface VotingResult {
  winner: AgentType;
  totalVotes: number;
  weightedScores: Record<AgentType, number>;
  margin: number;           // Winner's lead
  unanimous: boolean;
  rounds: number;
  votes: WeightedVote[];
}

// ============================================================================
// DEBATE / REFINEMENT
// ============================================================================

/**
 * Configuration for debate rounds
 */
export interface DebateConfig {
  maxRounds: number;
  convergenceThreshold: number;   // Stop if positions converge
  timeoutMs: number;
  allowPositionChange: boolean;   // Can agents change their vote?
  requireUnanimity: boolean;
  minConfidenceToWin: number;     // Minimum confidence for winner
}

/**
 * A single debate round
 */
export interface DebateRound {
  roundNumber: number;
  critiques: AgentCritique[];
  refinements: ProposalRefinement[];
  votingResult: VotingResult;
  convergenceScore: number;       // 0-1, how close to consensus
  timestamp: number;
}

/**
 * Agent's critique of other proposals
 */
export interface AgentCritique {
  criticId: AgentType;
  targetId: AgentType;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  riskConcerns: string[];
  overallScore: number;    // 1-10
}

/**
 * Refinement to a proposal based on feedback
 */
export interface ProposalRefinement {
  agentId: AgentType;
  originalProposal: AgentProposal;
  refinedProposal: AgentProposal;
  changesDescription: string;
  addressedCritiques: string[];
  confidenceChange: number; // positive = more confident
}

// ============================================================================
// CONSENSUS RESULT
// ============================================================================

/**
 * Final consensus outcome
 */
export interface ConsensusResult {
  success: boolean;
  method: 'unanimous' | 'majority' | 'weighted' | 'expertise' | 'synthesis' | 'timeout';
  
  // Winner
  selectedProposal: AgentProposal;
  confidence: number;
  
  // Process details
  totalRounds: number;
  conflicts: Conflict[];
  resolvedConflicts: number;
  
  // Voting
  votingResult: VotingResult;
  
  // Minority opinions (important for transparency)
  minorityOpinions: MinorityOpinion[];
  
  // Metrics
  convergenceScore: number;
  processingTime: number;
  
  // Recommendations
  recommendations: string[];
  warnings: string[];
}

/**
 * Preserved minority opinion
 */
export interface MinorityOpinion {
  agentId: AgentType;
  proposal: AgentProposal;
  reason: string;
  concernLevel: 'note' | 'warning' | 'strong_disagreement';
  supportingAgents: AgentType[];
}

// ============================================================================
// CONSENSUS ENGINE CONFIG
// ============================================================================

/**
 * Configuration for the consensus engine
 */
export interface ConsensusConfig {
  // Voting
  votingMethod: 'simple' | 'weighted' | 'ranked_choice' | 'approval';
  
  // Debate
  debate: DebateConfig;
  
  // Conflict resolution
  conflictResolutionStrategy: 'vote' | 'expertise' | 'synthesis' | 'hybrid';
  
  // Thresholds
  unanimityThreshold: number;      // % for "unanimous" (e.g., 0.9 = 90%)
  majorityThreshold: number;       // % for majority (e.g., 0.5 = 50%)
  minConfidenceForConsensus: number;
  
  // Behavior
  preserveMinorityOpinions: boolean;
  requireExplanations: boolean;
  enableIterativeRefinement: boolean;
  
  // Domain weights (which domains matter for this task)
  domainWeights?: Record<string, number>;
}

/**
 * Default consensus configuration
 */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  votingMethod: 'weighted',
  debate: {
    maxRounds: 3,
    convergenceThreshold: 0.85,
    timeoutMs: 60000,
    allowPositionChange: true,
    requireUnanimity: false,
    minConfidenceToWin: 0.6
  },
  conflictResolutionStrategy: 'hybrid',
  unanimityThreshold: 0.9,
  majorityThreshold: 0.5,
  minConfidenceForConsensus: 0.7,
  preserveMinorityOpinions: true,
  requireExplanations: true,
  enableIterativeRefinement: true
};
