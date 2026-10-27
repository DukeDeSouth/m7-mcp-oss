/**
 * M7 Hive Consensus Engine
 * 
 * Main orchestrator for achieving consensus among agents.
 * Combines weighted voting, conflict resolution, and iterative refinement.
 */

import { AgentType, AgentProposal } from '../types/agent.js';
import {
  ConsensusConfig,
  ConsensusResult,
  MinorityOpinion,
  Conflict,
  DebateRound,
  AgentCritique,
  ProposalRefinement,
  DEFAULT_CONSENSUS_CONFIG
} from './types.js';
import {
  conductWeightedVoting,
  conductRankedChoiceVoting,
  calculateExpertiseWeight,
  extractTaskDomains
} from './weightedVoting.js';
import { detectConflicts, resolveConflicts } from './conflictResolver.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('[Consensus]');

// ============================================================================
// CONSENSUS ENGINE
// ============================================================================

export class ConsensusEngine {
  private config: ConsensusConfig;
  
  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
  }
  
  /**
   * Build consensus from agent proposals
   */
  async buildConsensus(
    proposals: AgentProposal[],
    taskDescription: string
  ): Promise<ConsensusResult> {
    const startTime = Date.now();
    log.debug(`Building consensus from ${proposals.length} proposals`);
    
    if (proposals.length === 0) {
      throw new Error('No proposals to build consensus from');
    }
    
    if (proposals.length === 1) {
      return this.singleProposalResult(proposals[0], startTime);
    }
    
    try {
      // 1. Detect conflicts
      const conflicts = detectConflicts(proposals, taskDescription);
      log.debug(`Detected ${conflicts.length} conflicts`);
      
      // 2. Resolve conflicts
      const resolvedConflicts = resolveConflicts(
        conflicts,
        proposals,
        taskDescription,
        this.config
      );
      
      // 3. Conduct voting
      const votingResult = this.config.votingMethod === 'ranked_choice'
        ? conductRankedChoiceVoting(proposals, taskDescription, this.config)
        : conductWeightedVoting(proposals, taskDescription, this.config);
      
      log.debug(`Voting result: ${votingResult.winner} with margin ${votingResult.margin.toFixed(2)}`);
      
      // 4. Check if iterative refinement needed
      let refinedProposals = proposals;
      let rounds = 1;
      
      if (this.config.enableIterativeRefinement && !votingResult.unanimous) {
        const refinementResult = await this.iterativeRefinement(
          proposals,
          taskDescription,
          resolvedConflicts
        );
        refinedProposals = refinementResult.proposals;
        rounds = refinementResult.rounds;
      }
      
      // 5. Final vote on refined proposals
      const finalVoting = rounds > 1
        ? conductWeightedVoting(refinedProposals, taskDescription, this.config)
        : votingResult;
      
      // 6. Get winning proposal
      const selectedProposal = refinedProposals.find(
        p => p.agentId === finalVoting.winner
      ) ?? proposals[0];
      
      // 7. Collect minority opinions
      const minorityOpinions = this.collectMinorityOpinions(
        refinedProposals,
        finalVoting.winner,
        resolvedConflicts
      );
      
      // 8. Calculate convergence
      const convergenceScore = this.calculateConvergence(
        refinedProposals,
        finalVoting
      );
      
      // 9. Determine consensus method
      const method = this.determineConsensusMethod(finalVoting, convergenceScore);
      
      const processingTime = Date.now() - startTime;
      
      return {
        success: true,
        method,
        selectedProposal,
        confidence: this.calculateFinalConfidence(selectedProposal, finalVoting, convergenceScore),
        totalRounds: rounds,
        conflicts: resolvedConflicts,
        resolvedConflicts: resolvedConflicts.filter(c => c.resolution).length,
        votingResult: finalVoting,
        minorityOpinions,
        convergenceScore,
        processingTime,
        recommendations: this.generateRecommendations(
          resolvedConflicts,
          minorityOpinions,
          convergenceScore
        ),
        warnings: this.generateWarnings(resolvedConflicts, finalVoting)
      };
    } catch (error) {
      log.debug('Consensus building failed:', error);
      
      // Fallback to simple selection
      return this.fallbackConsensus(proposals, startTime);
    }
  }
  
  /**
   * Iterative refinement of proposals based on feedback
   */
  private async iterativeRefinement(
    proposals: AgentProposal[],
    taskDescription: string,
    conflicts: Conflict[]
  ): Promise<{ proposals: AgentProposal[]; rounds: number }> {
    let currentProposals = [...proposals];
    const maxRounds = this.config.debate.maxRounds;
    let round = 0;
    
    while (round < maxRounds) {
      round++;
      log.debug(`Refinement round ${round}/${maxRounds}`);
      
      // Generate critiques
      const critiques = this.generateCritiques(currentProposals, conflicts);
      
      // Refine proposals based on critiques
      const refined = this.refineProposals(currentProposals, critiques);
      
      // Check convergence
      const convergence = this.measureConvergence(currentProposals, refined);
      log.debug(`Convergence score: ${convergence.toFixed(2)}`);
      
      if (convergence >= this.config.debate.convergenceThreshold) {
        log.debug(`Convergence reached at round ${round}`);
        return { proposals: refined, rounds: round };
      }
      
      currentProposals = refined;
    }
    
    return { proposals: currentProposals, rounds: round };
  }
  
  /**
   * Generate critiques from each agent's perspective
   */
  private generateCritiques(
    proposals: AgentProposal[],
    conflicts: Conflict[]
  ): AgentCritique[] {
    const critiques: AgentCritique[] = [];
    
    for (const critic of proposals) {
      for (const target of proposals) {
        if (critic.agentId === target.agentId) continue;
        
        const critique = this.generateCritique(critic, target, conflicts);
        critiques.push(critique);
      }
    }
    
    return critiques;
  }
  
  /**
   * Generate a single critique
   */
  private generateCritique(
    critic: AgentProposal,
    target: AgentProposal,
    conflicts: Conflict[]
  ): AgentCritique {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const suggestions: string[] = [];
    const riskConcerns: string[] = [];
    
    // Analyze target proposal from critic's perspective
    
    // Strengths
    if (target.implementation_steps && target.implementation_steps.length > 3) {
      strengths.push('Detailed implementation steps');
    }
    if (target.requirements && target.requirements.length > 0) {
      strengths.push('Clear requirements identified');
    }
    if (target.confidence > 0.8) {
      strengths.push('High confidence in approach');
    }
    if (target.alternatives && target.alternatives.length > 0) {
      strengths.push('Considers alternatives');
    }
    
    // Weaknesses (based on critic's expertise)
    if (critic.agentId === 'security') {
      if (!target.proposal.toLowerCase().includes('security')) {
        weaknesses.push('Limited security considerations');
        suggestions.push('Add explicit security measures');
      }
    }
    if (critic.agentId === 'testing') {
      if (!target.proposal.toLowerCase().includes('test')) {
        weaknesses.push('No testing strategy mentioned');
        suggestions.push('Include testing approach');
      }
    }
    if (critic.agentId === 'performance') {
      if (!target.proposal.toLowerCase().includes('perform')) {
        weaknesses.push('Performance implications not addressed');
        suggestions.push('Consider performance impact');
      }
    }
    
    // Risk concerns from conflicts
    const relevantConflicts = conflicts.filter(
      c => c.agents.includes(target.agentId) && c.agents.includes(critic.agentId)
    );
    for (const conflict of relevantConflicts) {
      if (conflict.severity === 'major' || conflict.severity === 'blocking') {
        riskConcerns.push(`Conflict: ${conflict.description}`);
      }
    }
    
    // Calculate overall score
    const baseScore = target.confidence * 10;
    const strengthBonus = Math.min(strengths.length * 0.5, 2);
    const weaknessPenalty = Math.min(weaknesses.length * 0.5, 2);
    const riskPenalty = Math.min(riskConcerns.length * 0.3, 1);
    
    const overallScore = Math.max(1, Math.min(10,
      baseScore + strengthBonus - weaknessPenalty - riskPenalty
    ));
    
    return {
      criticId: critic.agentId,
      targetId: target.agentId,
      strengths,
      weaknesses,
      suggestions,
      riskConcerns,
      overallScore
    };
  }
  
  /**
   * Refine proposals based on critiques
   */
  private refineProposals(
    proposals: AgentProposal[],
    critiques: AgentCritique[]
  ): AgentProposal[] {
    return proposals.map(proposal => {
      const receivedCritiques = critiques.filter(c => c.targetId === proposal.agentId);
      
      if (receivedCritiques.length === 0) {
        return proposal;
      }
      
      // Aggregate feedback
      const allSuggestions = receivedCritiques.flatMap(c => c.suggestions);
      const allWeaknesses = receivedCritiques.flatMap(c => c.weaknesses);
      const avgScore = receivedCritiques.reduce((sum, c) => sum + c.overallScore, 0) / receivedCritiques.length;
      
      // Adjust confidence based on feedback
      const confidenceAdjustment = (avgScore - 5) * 0.05; // -0.25 to +0.25
      
      // Add suggestions as requirements if not addressed
      const newRequirements = [...(proposal.requirements ?? [])];
      for (const suggestion of allSuggestions.slice(0, 3)) {
        if (!newRequirements.some(r => r.toLowerCase().includes(suggestion.toLowerCase().split(' ')[0]))) {
          newRequirements.push(suggestion);
        }
      }
      
      // Add weaknesses as risks if not already present
      const newRisks = [...(proposal.risks ?? [])];
      for (const weakness of allWeaknesses.slice(0, 2)) {
        if (!newRisks.includes(weakness)) {
          newRisks.push(weakness);
        }
      }
      
      return {
        ...proposal,
        confidence: Math.max(0.1, Math.min(1, proposal.confidence + confidenceAdjustment)),
        requirements: newRequirements,
        risks: newRisks
      };
    });
  }
  
  /**
   * Measure convergence between proposal sets
   */
  private measureConvergence(
    before: AgentProposal[],
    after: AgentProposal[]
  ): number {
    let totalSimilarity = 0;
    
    for (let i = 0; i < before.length; i++) {
      const prev = before[i];
      const curr = after.find(p => p.agentId === prev.agentId);
      
      if (!curr) continue;
      
      // Compare confidence
      const confDiff = Math.abs(prev.confidence - curr.confidence);
      
      // Compare content (simplified)
      const prevWords = new Set(prev.proposal.toLowerCase().split(/\s+/));
      const currWords = new Set(curr.proposal.toLowerCase().split(/\s+/));
      const intersection = [...prevWords].filter(w => currWords.has(w)).length;
      const union = new Set([...prevWords, ...currWords]).size;
      const jaccardSim = intersection / Math.max(union, 1);
      
      // Combined similarity
      totalSimilarity += (1 - confDiff) * 0.3 + jaccardSim * 0.7;
    }
    
    return totalSimilarity / Math.max(before.length, 1);
  }
  
  /**
   * Collect minority opinions for transparency
   */
  private collectMinorityOpinions(
    proposals: AgentProposal[],
    winner: AgentType,
    conflicts: Conflict[]
  ): MinorityOpinion[] {
    if (!this.config.preserveMinorityOpinions) {
      return [];
    }
    
    const minority: MinorityOpinion[] = [];
    
    for (const proposal of proposals) {
      if (proposal.agentId === winner) continue;
      
      // Determine concern level
      const relevantConflicts = conflicts.filter(
        c => c.agents.includes(proposal.agentId) && c.agents.includes(winner)
      );
      
      let concernLevel: 'note' | 'warning' | 'strong_disagreement' = 'note';
      
      if (relevantConflicts.some(c => c.severity === 'blocking')) {
        concernLevel = 'strong_disagreement';
      } else if (relevantConflicts.some(c => c.severity === 'major')) {
        concernLevel = 'warning';
      }
      
      // Find supporting agents
      const supportingAgents = proposals
        .filter(p => p.agentId !== proposal.agentId && p.agentId !== winner)
        .filter(p => this.proposalsSimilar(p, proposal))
        .map(p => p.agentId);
      
      minority.push({
        agentId: proposal.agentId,
        proposal,
        reason: this.generateDissentReason(proposal, relevantConflicts),
        concernLevel,
        supportingAgents
      });
    }
    
    return minority;
  }
  
  /**
   * Check if two proposals are similar
   */
  private proposalsSimilar(p1: AgentProposal, p2: AgentProposal): boolean {
    const words1 = new Set(p1.proposal.toLowerCase().split(/\s+/));
    const words2 = new Set(p2.proposal.toLowerCase().split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;
    return (intersection / union) > 0.3;
  }
  
  /**
   * Generate reason for dissent
   */
  private generateDissentReason(
    proposal: AgentProposal,
    conflicts: Conflict[]
  ): string {
    if (conflicts.length > 0) {
      return `Disagrees on: ${conflicts.map(c => c.type).join(', ')}`;
    }
    return `Alternative approach with ${(proposal.confidence * 100).toFixed(0)}% confidence`;
  }
  
  /**
   * Calculate convergence score
   */
  private calculateConvergence(
    proposals: AgentProposal[],
    voting: { weightedScores: Record<AgentType, number>; margin: number }
  ): number {
    // Higher margin = more convergence
    const marginScore = Math.min(voting.margin * 2, 1);
    
    // Check confidence spread
    const confidences = proposals.map(p => p.confidence);
    const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const confVariance = confidences.reduce((sum, c) => sum + Math.pow(c - avgConf, 2), 0) / confidences.length;
    const confScore = 1 - Math.sqrt(confVariance);
    
    return marginScore * 0.6 + confScore * 0.4;
  }
  
  /**
   * Determine consensus method achieved
   */
  private determineConsensusMethod(
    voting: { unanimous: boolean; margin: number },
    convergence: number
  ): ConsensusResult['method'] {
    if (voting.unanimous) {
      return 'unanimous';
    }
    if (convergence >= this.config.unanimityThreshold) {
      return 'weighted';
    }
    if (voting.margin >= 0.5) {
      return 'majority';
    }
    return 'weighted';
  }
  
  /**
   * Calculate final confidence
   */
  private calculateFinalConfidence(
    proposal: AgentProposal,
    voting: { margin: number; unanimous: boolean },
    convergence: number
  ): number {
    const baseConf = proposal.confidence;
    const votingBoost = voting.unanimous ? 0.1 : voting.margin * 0.05;
    const convergenceBoost = (convergence - 0.5) * 0.1;
    
    return Math.min(1, baseConf + votingBoost + convergenceBoost);
  }
  
  /**
   * Generate recommendations
   */
  private generateRecommendations(
    conflicts: Conflict[],
    minority: MinorityOpinion[],
    convergence: number
  ): string[] {
    const recs: string[] = [];
    
    if (convergence < 0.6) {
      recs.push('Low convergence - consider gathering more requirements');
    }
    
    if (conflicts.some(c => c.severity === 'blocking')) {
      recs.push('Blocking conflicts detected - human review recommended');
    }
    
    if (minority.some(m => m.concernLevel === 'strong_disagreement')) {
      recs.push('Strong dissent from some agents - review minority opinions');
    }
    
    const unresolvedConflicts = conflicts.filter(c => !c.resolution || c.resolution.method === 'escalate');
    if (unresolvedConflicts.length > 0) {
      recs.push(`${unresolvedConflicts.length} conflicts need manual resolution`);
    }
    
    return recs;
  }
  
  /**
   * Generate warnings
   */
  private generateWarnings(
    conflicts: Conflict[],
    voting: { margin: number }
  ): string[] {
    const warnings: string[] = [];
    
    if (voting.margin < 0.1) {
      warnings.push('Very close vote - winner may not be significantly better');
    }
    
    const blockingConflicts = conflicts.filter(c => c.severity === 'blocking');
    if (blockingConflicts.length > 0) {
      warnings.push(`${blockingConflicts.length} blocking conflicts require attention`);
    }
    
    return warnings;
  }
  
  /**
   * Handle single proposal case
   */
  private singleProposalResult(
    proposal: AgentProposal,
    startTime: number
  ): ConsensusResult {
    return {
      success: true,
      method: 'unanimous',
      selectedProposal: proposal,
      confidence: proposal.confidence,
      totalRounds: 1,
      conflicts: [],
      resolvedConflicts: 0,
      votingResult: {
        winner: proposal.agentId,
        totalVotes: 1,
        weightedScores: { [proposal.agentId]: 1 } as Record<AgentType, number>,
        margin: 1,
        unanimous: true,
        rounds: 1,
        votes: [{
          voterId: proposal.agentId,
          votedFor: proposal.agentId,
          weight: 1,
          confidence: proposal.confidence,
          reasoning: 'Single proposal'
        }]
      },
      minorityOpinions: [],
      convergenceScore: 1,
      processingTime: Date.now() - startTime,
      recommendations: [],
      warnings: []
    };
  }
  
  /**
   * Fallback consensus when normal process fails
   */
  private fallbackConsensus(
    proposals: AgentProposal[],
    startTime: number
  ): ConsensusResult {
    // Sort by confidence and pick highest
    const sorted = [...proposals].sort((a, b) => b.confidence - a.confidence);
    const winner = sorted[0];
    
    return {
      success: true,
      method: 'expertise',
      selectedProposal: winner,
      confidence: winner.confidence * 0.8, // Reduced due to fallback
      totalRounds: 1,
      conflicts: [],
      resolvedConflicts: 0,
      votingResult: {
        winner: winner.agentId,
        totalVotes: proposals.length,
        weightedScores: Object.fromEntries(
          proposals.map(p => [p.agentId, p.confidence])
        ) as Record<AgentType, number>,
        margin: sorted.length > 1 ? sorted[0].confidence - sorted[1].confidence : 1,
        unanimous: false,
        rounds: 1,
        votes: []
      },
      minorityOpinions: [],
      convergenceScore: 0.5,
      processingTime: Date.now() - startTime,
      recommendations: ['Fallback mode used - normal consensus failed'],
      warnings: ['Results may be suboptimal due to fallback']
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { ConsensusConfig, ConsensusResult, MinorityOpinion } from './types.js';
