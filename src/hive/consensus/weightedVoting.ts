/**
 * M7 Hive Consensus - Weighted Voting System
 * 
 * Implements expertise-weighted voting for agent proposals.
 */

import { AgentType, AgentProposal } from '../types/agent.js';
import {
  AgentExpertise,
  DEFAULT_EXPERTISE,
  WeightedVote,
  VotingResult,
  ConsensusConfig,
  DEFAULT_CONSENSUS_CONFIG
} from './types.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('[Consensus-Vote]');

/**
 * Calculate expertise weight for an agent based on task domains
 */
export function calculateExpertiseWeight(
  agentType: AgentType,
  taskDomains: string[],
  domainWeights?: Record<string, number>
): number {
  const expertise = DEFAULT_EXPERTISE[agentType];
  if (!expertise) return 0.5;
  
  if (taskDomains.length === 0) {
    return expertise.overallWeight;
  }
  
  let totalWeight = 0;
  let totalDomainWeight = 0;
  
  for (const domain of taskDomains) {
    const domainLower = domain.toLowerCase();
    const expertiseScore = expertise.domains[domainLower] ?? 0.5;
    const domainImportance = domainWeights?.[domainLower] ?? 1.0;
    
    totalWeight += expertiseScore * domainImportance;
    totalDomainWeight += domainImportance;
  }
  
  const domainBasedWeight = totalDomainWeight > 0 
    ? totalWeight / totalDomainWeight 
    : expertise.overallWeight;
  
  // Combine with historical accuracy
  return (domainBasedWeight * 0.7) + (expertise.historicalAccuracy * 0.3);
}

/**
 * Extract task domains from description
 */
export function extractTaskDomains(description: string): string[] {
  const domains: string[] = [];
  const descLower = description.toLowerCase();
  
  const domainKeywords: Record<string, string[]> = {
    security: ['security', 'auth', 'encrypt', 'vulnerability', 'xss', 'sql injection', 'csrf'],
    performance: ['performance', 'optimize', 'speed', 'fast', 'slow', 'cache', 'latency'],
    architecture: ['architecture', 'design', 'structure', 'pattern', 'refactor', 'modular'],
    testing: ['test', 'coverage', 'unit test', 'integration', 'e2e', 'quality'],
    requirements: ['require', 'feature', 'spec', 'user story', 'acceptance'],
    coding: ['implement', 'code', 'develop', 'build', 'create', 'function'],
    documentation: ['document', 'readme', 'api doc', 'comment'],
    scalability: ['scale', 'load', 'traffic', 'concurrent', 'distributed'],
    best_practices: ['best practice', 'standard', 'convention', 'lint'],
    risks: ['risk', 'danger', 'concern', 'issue', 'problem']
  };
  
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some(kw => descLower.includes(kw))) {
      domains.push(domain);
    }
  }
  
  return domains.length > 0 ? domains : ['coding', 'requirements'];
}

/**
 * Conduct weighted voting on proposals
 */
export function conductWeightedVoting(
  proposals: AgentProposal[],
  taskDescription: string,
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG
): VotingResult {
  const taskDomains = extractTaskDomains(taskDescription);
  log.debug(`Task domains: ${taskDomains.join(', ')}`);
  
  const votes: WeightedVote[] = [];
  const scores: Record<string, number> = {};
  
  // Initialize scores
  for (const proposal of proposals) {
    scores[proposal.agentId] = 0;
  }
  
  // Each agent votes (cross-voting: each evaluates others)
  for (const voter of proposals) {
    const voterWeight = calculateExpertiseWeight(
      voter.agentId,
      taskDomains,
      config.domainWeights
    );
    
    // Agent votes for the proposal it finds best (not itself)
    const otherProposals = proposals.filter(p => p.agentId !== voter.agentId);
    
    if (otherProposals.length === 0) {
      // Only one proposal - vote for self
      votes.push({
        voterId: voter.agentId,
        votedFor: voter.agentId,
        weight: voterWeight,
        confidence: voter.confidence,
        reasoning: 'Single proposal'
      });
      scores[voter.agentId] += voterWeight * voter.confidence;
      continue;
    }
    
    // Score each other proposal
    const rankings: { agentId: AgentType; rank: number; score: number }[] = [];
    
    for (const other of otherProposals) {
      const complementScore = calculateComplementScore(voter, other);
      rankings.push({
        agentId: other.agentId,
        rank: 0, // Will be set after sorting
        score: complementScore
      });
    }
    
    // Sort by score (highest first)
    rankings.sort((a, b) => b.score - a.score);
    rankings.forEach((r, i) => r.rank = i + 1);
    
    // Vote for top choice
    const topChoice = rankings[0];
    
    votes.push({
      voterId: voter.agentId,
      votedFor: topChoice.agentId,
      weight: voterWeight,
      confidence: voter.confidence,
      reasoning: `Best complementary proposal (score: ${topChoice.score.toFixed(2)})`,
      rankings
    });
    
    // Add weighted score
    scores[topChoice.agentId] += voterWeight * voter.confidence;
  }
  
  // Also add self-confidence to scores
  for (const proposal of proposals) {
    const selfWeight = calculateExpertiseWeight(
      proposal.agentId,
      taskDomains,
      config.domainWeights
    );
    scores[proposal.agentId] += selfWeight * proposal.confidence * 0.5; // 50% weight for self
  }
  
  // Find winner
  let winner: AgentType = proposals[0].agentId;
  let maxScore = scores[proposals[0].agentId];
  
  for (const proposal of proposals) {
    if (scores[proposal.agentId] > maxScore) {
      maxScore = scores[proposal.agentId];
      winner = proposal.agentId;
    }
  }
  
  // Calculate margin
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const margin = sortedScores.length > 1 
    ? sortedScores[0] - sortedScores[1]
    : sortedScores[0];
  
  // Check for unanimity
  const votesForWinner = votes.filter(v => v.votedFor === winner).length;
  const unanimous = votesForWinner === votes.length;
  
  log.debug(`Voting result: ${winner} wins with score ${maxScore.toFixed(2)}, margin ${margin.toFixed(2)}`);
  
  return {
    winner,
    totalVotes: votes.length,
    weightedScores: scores as Record<AgentType, number>,
    margin,
    unanimous,
    rounds: 1,
    votes
  };
}

/**
 * Calculate how well two proposals complement each other
 */
function calculateComplementScore(voter: AgentProposal, other: AgentProposal): number {
  let score = other.confidence;
  
  // Bonus for detailed steps
  if (other.implementation_steps && other.implementation_steps.length > 0) {
    score += 0.1 * Math.min(other.implementation_steps.length / 5, 1);
  }
  
  // Bonus for identified requirements
  if (other.requirements && other.requirements.length > 0) {
    score += 0.1 * Math.min(other.requirements.length / 3, 1);
  }
  
  // Penalty for too many risks without mitigation
  if (other.risks && other.risks.length > 3) {
    score -= 0.05;
  }
  
  // Bonus for alternatives (shows thorough thinking)
  if (other.alternatives && other.alternatives.length > 0) {
    score += 0.05;
  }
  
  // Check if proposals are compatible
  const voterKeywords = extractKeywords(voter.proposal);
  const otherKeywords = extractKeywords(other.proposal);
  const overlap = voterKeywords.filter(k => otherKeywords.includes(k)).length;
  const overlapRatio = overlap / Math.max(voterKeywords.length, 1);
  
  // Some overlap is good (compatible), too much means redundant
  if (overlapRatio > 0.2 && overlapRatio < 0.8) {
    score += 0.1;
  }
  
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Extract keywords from text
 */
function extractKeywords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);
}

/**
 * Ranked choice voting (instant runoff)
 */
export function conductRankedChoiceVoting(
  proposals: AgentProposal[],
  taskDescription: string,
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG
): VotingResult {
  const taskDomains = extractTaskDomains(taskDescription);
  let candidates = [...proposals];
  let rounds = 0;
  const maxRounds = proposals.length;
  
  const allVotes: WeightedVote[] = [];
  
  while (candidates.length > 1 && rounds < maxRounds) {
    rounds++;
    
    const roundScores: Record<string, number> = {};
    for (const c of candidates) {
      roundScores[c.agentId] = 0;
    }
    
    // Each agent votes
    for (const voter of proposals) {
      const weight = calculateExpertiseWeight(voter.agentId, taskDomains, config.domainWeights);
      
      // Find top choice among remaining candidates
      const availableChoices = candidates.filter(c => c.agentId !== voter.agentId);
      if (availableChoices.length === 0) {
        roundScores[voter.agentId] += weight;
        continue;
      }
      
      let bestChoice = availableChoices[0];
      let bestScore = calculateComplementScore(voter, bestChoice);
      
      for (const choice of availableChoices.slice(1)) {
        const score = calculateComplementScore(voter, choice);
        if (score > bestScore) {
          bestScore = score;
          bestChoice = choice;
        }
      }
      
      roundScores[bestChoice.agentId] += weight;
      
      if (rounds === 1) {
        allVotes.push({
          voterId: voter.agentId,
          votedFor: bestChoice.agentId,
          weight,
          confidence: voter.confidence,
          reasoning: `Round ${rounds} choice`
        });
      }
    }
    
    // Check for majority
    const totalWeight = Object.values(roundScores).reduce((a, b) => a + b, 0);
    const majorityThreshold = totalWeight * config.majorityThreshold;
    
    const winner = Object.entries(roundScores).find(([_, score]) => score >= majorityThreshold);
    if (winner) {
      return {
        winner: winner[0] as AgentType,
        totalVotes: proposals.length,
        weightedScores: roundScores as Record<AgentType, number>,
        margin: winner[1] - majorityThreshold,
        unanimous: Object.values(roundScores).filter(s => s > 0).length === 1,
        rounds,
        votes: allVotes
      };
    }
    
    // Eliminate lowest scorer
    const lowestScore = Math.min(...Object.values(roundScores));
    candidates = candidates.filter(c => roundScores[c.agentId] > lowestScore);
  }
  
  // Return last remaining candidate
  const finalScores: Record<string, number> = {};
  for (const p of proposals) {
    finalScores[p.agentId] = candidates.some(c => c.agentId === p.agentId) ? 1 : 0;
  }
  
  return {
    winner: candidates[0]?.agentId ?? proposals[0].agentId,
    totalVotes: proposals.length,
    weightedScores: finalScores as Record<AgentType, number>,
    margin: 0,
    unanimous: candidates.length === 1,
    rounds,
    votes: allVotes
  };
}
