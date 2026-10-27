/**
 * M7 Hive Consensus - Conflict Detection and Resolution
 * 
 * Detects and resolves conflicts between agent proposals.
 */

import { AgentType, AgentProposal } from '../types/agent.js';
import {
  Conflict,
  ConflictType,
  ConflictPosition,
  ConflictResolution,
  ConsensusConfig,
  DEFAULT_CONSENSUS_CONFIG
} from './types.js';
import { calculateExpertiseWeight, extractTaskDomains } from './weightedVoting.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('[Consensus-Conflict]');

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Detect conflicts between proposals
 */
export function detectConflicts(
  proposals: AgentProposal[],
  taskDescription: string
): Conflict[] {
  const conflicts: Conflict[] = [];
  
  if (proposals.length < 2) {
    return conflicts;
  }
  
  // Compare each pair of proposals
  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const pairConflicts = detectPairConflicts(
        proposals[i],
        proposals[j],
        taskDescription
      );
      conflicts.push(...pairConflicts);
    }
  }
  
  // Deduplicate similar conflicts
  return deduplicateConflicts(conflicts);
}

/**
 * Detect conflicts between two proposals
 */
function detectPairConflicts(
  proposal1: AgentProposal,
  proposal2: AgentProposal,
  taskDescription: string
): Conflict[] {
  const conflicts: Conflict[] = [];
  
  // 1. Check for approach conflicts
  const approachConflict = detectApproachConflict(proposal1, proposal2);
  if (approachConflict) {
    conflicts.push(approachConflict);
  }
  
  // 2. Check for technology conflicts
  const techConflict = detectTechnologyConflict(proposal1, proposal2);
  if (techConflict) {
    conflicts.push(techConflict);
  }
  
  // 3. Check for risk assessment conflicts
  const riskConflict = detectRiskAssessmentConflict(proposal1, proposal2);
  if (riskConflict) {
    conflicts.push(riskConflict);
  }
  
  // 4. Check for implementation conflicts
  const implConflict = detectImplementationConflict(proposal1, proposal2);
  if (implConflict) {
    conflicts.push(implConflict);
  }
  
  return conflicts;
}

/**
 * Detect approach-level conflicts
 */
function detectApproachConflict(
  p1: AgentProposal,
  p2: AgentProposal
): Conflict | null {
  // Keywords that indicate mutually exclusive approaches
  const exclusiveApproaches = [
    ['monolithic', 'microservices'],
    ['synchronous', 'asynchronous'],
    ['sql', 'nosql'],
    ['server-side', 'client-side'],
    ['rest', 'graphql'],
    ['rewrite', 'refactor'],
    ['build', 'buy'],
    ['custom', 'library']
  ];
  
  const text1 = (p1.proposal + ' ' + p1.reasoning).toLowerCase();
  const text2 = (p2.proposal + ' ' + p2.reasoning).toLowerCase();
  
  for (const [approach1, approach2] of exclusiveApproaches) {
    const has1In1 = text1.includes(approach1);
    const has2In1 = text1.includes(approach2);
    const has1In2 = text2.includes(approach1);
    const has2In2 = text2.includes(approach2);
    
    // Conflict if one proposal uses approach1 and other uses approach2
    if ((has1In1 && has2In2) || (has2In1 && has1In2)) {
      return {
        id: `conflict-approach-${approach1}-${approach2}`,
        type: 'approach',
        severity: 'major',
        description: `Conflicting approaches: ${approach1} vs ${approach2}`,
        agents: [p1.agentId, p2.agentId],
        positions: [
          {
            agentId: p1.agentId,
            stance: has1In1 ? approach1 : approach2,
            reasoning: extractRelevantSentence(p1.proposal, has1In1 ? approach1 : approach2),
            confidence: p1.confidence
          },
          {
            agentId: p2.agentId,
            stance: has1In2 ? approach1 : approach2,
            reasoning: extractRelevantSentence(p2.proposal, has1In2 ? approach1 : approach2),
            confidence: p2.confidence
          }
        ]
      };
    }
  }
  
  return null;
}

/**
 * Detect technology choice conflicts
 */
function detectTechnologyConflict(
  p1: AgentProposal,
  p2: AgentProposal
): Conflict | null {
  // Technology categories with alternatives
  const techCategories: Record<string, string[]> = {
    database: ['postgres', 'mysql', 'mongodb', 'redis', 'sqlite', 'dynamodb'],
    framework: ['react', 'vue', 'angular', 'svelte', 'solid'],
    backend: ['express', 'fastify', 'koa', 'nestjs', 'hapi'],
    orm: ['prisma', 'drizzle', 'typeorm', 'sequelize', 'mongoose'],
    state: ['redux', 'zustand', 'jotai', 'recoil', 'mobx'],
    testing: ['jest', 'vitest', 'mocha', 'ava', 'playwright']
  };
  
  const text1 = (p1.proposal + ' ' + p1.reasoning).toLowerCase();
  const text2 = (p2.proposal + ' ' + p2.reasoning).toLowerCase();
  
  for (const [category, options] of Object.entries(techCategories)) {
    const tech1 = options.filter(t => text1.includes(t));
    const tech2 = options.filter(t => text2.includes(t));
    
    // Conflict if they recommend different options in same category
    if (tech1.length > 0 && tech2.length > 0) {
      const different = tech1.filter(t => !tech2.includes(t));
      if (different.length > 0) {
        return {
          id: `conflict-tech-${category}`,
          type: 'technology',
          severity: 'moderate',
          description: `Different ${category} recommendations: ${tech1.join('/')} vs ${tech2.join('/')}`,
          agents: [p1.agentId, p2.agentId],
          positions: [
            {
              agentId: p1.agentId,
              stance: tech1.join(', '),
              reasoning: `Recommends ${tech1.join(', ')} for ${category}`,
              confidence: p1.confidence
            },
            {
              agentId: p2.agentId,
              stance: tech2.join(', '),
              reasoning: `Recommends ${tech2.join(', ')} for ${category}`,
              confidence: p2.confidence
            }
          ],
          commonGround: tech1.filter(t => tech2.includes(t)).join(', ') || undefined
        };
      }
    }
  }
  
  return null;
}

/**
 * Detect risk assessment conflicts
 */
function detectRiskAssessmentConflict(
  p1: AgentProposal,
  p2: AgentProposal
): Conflict | null {
  const risks1 = p1.risks ?? [];
  const risks2 = p2.risks ?? [];
  
  // Significant difference in number of identified risks
  const riskDiff = Math.abs(risks1.length - risks2.length);
  
  if (riskDiff >= 3) {
    const moreRisks = risks1.length > risks2.length ? p1 : p2;
    const lessRisks = risks1.length > risks2.length ? p2 : p1;
    
    return {
      id: `conflict-risk-assessment`,
      type: 'risk_assessment',
      severity: riskDiff >= 5 ? 'major' : 'moderate',
      description: `Significant difference in risk assessment: ${moreRisks.agentId} identified ${Math.max(risks1.length, risks2.length)} risks, ${lessRisks.agentId} identified ${Math.min(risks1.length, risks2.length)}`,
      agents: [p1.agentId, p2.agentId],
      positions: [
        {
          agentId: moreRisks.agentId,
          stance: `Identified ${Math.max(risks1.length, risks2.length)} risks`,
          reasoning: 'Comprehensive risk analysis',
          confidence: moreRisks.confidence,
          evidence: (moreRisks === p1 ? risks1 : risks2).slice(0, 3)
        },
        {
          agentId: lessRisks.agentId,
          stance: `Identified ${Math.min(risks1.length, risks2.length)} risks`,
          reasoning: 'Focused on critical risks only',
          confidence: lessRisks.confidence,
          evidence: (lessRisks === p1 ? risks1 : risks2).slice(0, 3)
        }
      ]
    };
  }
  
  return null;
}

/**
 * Detect implementation detail conflicts
 */
function detectImplementationConflict(
  p1: AgentProposal,
  p2: AgentProposal
): Conflict | null {
  const steps1 = p1.implementation_steps ?? [];
  const steps2 = p2.implementation_steps ?? [];
  
  // Check for conflicting order of operations
  const orderKeywords = [
    ['database first', 'api first', 'ui first'],
    ['test first', 'implement first'],
    ['migrate then', 'develop then migrate']
  ];
  
  const steps1Text = steps1.join(' ').toLowerCase();
  const steps2Text = steps2.join(' ').toLowerCase();
  
  for (const keywords of orderKeywords) {
    const found1 = keywords.filter(k => steps1Text.includes(k));
    const found2 = keywords.filter(k => steps2Text.includes(k));
    
    if (found1.length > 0 && found2.length > 0 && 
        found1[0] !== found2[0]) {
      return {
        id: `conflict-impl-order`,
        type: 'implementation',
        severity: 'minor',
        description: `Different implementation order: ${found1[0]} vs ${found2[0]}`,
        agents: [p1.agentId, p2.agentId],
        positions: [
          {
            agentId: p1.agentId,
            stance: found1[0],
            reasoning: 'Recommended approach order',
            confidence: p1.confidence
          },
          {
            agentId: p2.agentId,
            stance: found2[0],
            reasoning: 'Recommended approach order',
            confidence: p2.confidence
          }
        ]
      };
    }
  }
  
  return null;
}

// ============================================================================
// CONFLICT RESOLUTION
// ============================================================================

/**
 * Resolve detected conflicts
 */
export function resolveConflicts(
  conflicts: Conflict[],
  proposals: AgentProposal[],
  taskDescription: string,
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG
): Conflict[] {
  const taskDomains = extractTaskDomains(taskDescription);
  
  return conflicts.map(conflict => ({
    ...conflict,
    resolution: resolveConflict(conflict, proposals, taskDomains, config)
  }));
}

/**
 * Resolve a single conflict
 */
function resolveConflict(
  conflict: Conflict,
  proposals: AgentProposal[],
  taskDomains: string[],
  config: ConsensusConfig
): ConflictResolution {
  switch (config.conflictResolutionStrategy) {
    case 'expertise':
      return resolveByExpertise(conflict, proposals, taskDomains);
    case 'vote':
      return resolveByVote(conflict, proposals, taskDomains, config);
    case 'synthesis':
      return resolveBySynthesis(conflict, proposals);
    case 'hybrid':
    default:
      return resolveHybrid(conflict, proposals, taskDomains, config);
  }
}

/**
 * Resolve conflict by expertise weight
 */
function resolveByExpertise(
  conflict: Conflict,
  proposals: AgentProposal[],
  taskDomains: string[]
): ConflictResolution {
  let maxWeight = 0;
  let winner: AgentType | undefined;
  
  for (const position of conflict.positions) {
    const weight = calculateExpertiseWeight(position.agentId, taskDomains);
    const adjustedWeight = weight * position.confidence;
    
    if (adjustedWeight > maxWeight) {
      maxWeight = adjustedWeight;
      winner = position.agentId;
    }
  }
  
  const dissent = conflict.positions
    .filter(p => p.agentId !== winner)
    .map(p => ({
      agentId: p.agentId,
      reason: p.reasoning
    }));
  
  return {
    method: 'expertise_override',
    outcome: conflict.positions.find(p => p.agentId === winner)?.stance ?? 'Unknown',
    winningPosition: winner,
    confidence: maxWeight,
    dissent
  };
}

/**
 * Resolve conflict by voting
 */
function resolveByVote(
  conflict: Conflict,
  proposals: AgentProposal[],
  taskDomains: string[],
  config: ConsensusConfig
): ConflictResolution {
  const votes: Record<string, number> = {};
  
  for (const position of conflict.positions) {
    votes[position.agentId] = 0;
  }
  
  // All agents vote
  for (const proposal of proposals) {
    const voterWeight = calculateExpertiseWeight(proposal.agentId, taskDomains);
    
    // Agents involved in conflict vote for their position
    const ownPosition = conflict.positions.find(p => p.agentId === proposal.agentId);
    if (ownPosition) {
      votes[proposal.agentId] += voterWeight;
      continue;
    }
    
    // Others vote based on alignment
    const proposalText = (proposal.proposal + ' ' + proposal.reasoning).toLowerCase();
    let bestMatch: AgentType | undefined;
    let bestMatchScore = 0;
    
    for (const position of conflict.positions) {
      const keywords = position.stance.toLowerCase().split(/\s+/);
      const matchScore = keywords.filter(k => proposalText.includes(k)).length;
      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
        bestMatch = position.agentId;
      }
    }
    
    if (bestMatch) {
      votes[bestMatch] += voterWeight * 0.5; // Half weight for non-participants
    }
  }
  
  // Find winner
  let winner: AgentType | undefined;
  let maxVotes = 0;
  
  for (const [agentId, voteCount] of Object.entries(votes)) {
    if (voteCount > maxVotes) {
      maxVotes = voteCount;
      winner = agentId as AgentType;
    }
  }
  
  return {
    method: 'weighted_vote',
    outcome: conflict.positions.find(p => p.agentId === winner)?.stance ?? 'Unknown',
    winningPosition: winner,
    confidence: maxVotes / Object.values(votes).reduce((a, b) => a + b, 1),
    dissent: conflict.positions
      .filter(p => p.agentId !== winner)
      .map(p => ({ agentId: p.agentId, reason: p.reasoning }))
  };
}

/**
 * Resolve conflict by synthesizing positions
 */
function resolveBySynthesis(
  conflict: Conflict,
  proposals: AgentProposal[]
): ConflictResolution {
  // Try to find common ground
  const stances = conflict.positions.map(p => p.stance.toLowerCase());
  const allWords = stances.flatMap(s => s.split(/\s+/));
  const wordCounts = new Map<string, number>();
  
  for (const word of allWords) {
    wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  }
  
  // Find words that appear in multiple positions
  const commonWords = [...wordCounts.entries()]
    .filter(([_, count]) => count >= 2)
    .map(([word]) => word);
  
  if (commonWords.length > 0 || conflict.commonGround) {
    return {
      method: 'synthesis',
      outcome: 'Hybrid approach combining elements from both positions',
      synthesizedSolution: conflict.commonGround ?? 
        `Combined approach using: ${commonWords.slice(0, 5).join(', ')}`,
      confidence: 0.7,
      dissent: []
    };
  }
  
  // Can't synthesize - escalate
  return {
    method: 'escalate',
    outcome: 'Requires human decision - positions are mutually exclusive',
    confidence: 0.3,
    dissent: conflict.positions.map(p => ({
      agentId: p.agentId,
      reason: p.reasoning
    }))
  };
}

/**
 * Hybrid resolution strategy
 */
function resolveHybrid(
  conflict: Conflict,
  proposals: AgentProposal[],
  taskDomains: string[],
  config: ConsensusConfig
): ConflictResolution {
  // Minor conflicts: try synthesis
  if (conflict.severity === 'minor') {
    const synthesis = resolveBySynthesis(conflict, proposals);
    if (synthesis.method !== 'escalate') {
      return synthesis;
    }
  }
  
  // Major/blocking conflicts: expertise + vote
  const expertiseResult = resolveByExpertise(conflict, proposals, taskDomains);
  const voteResult = resolveByVote(conflict, proposals, taskDomains, config);
  
  // If both agree, high confidence
  if (expertiseResult.winningPosition === voteResult.winningPosition) {
    return {
      ...expertiseResult,
      confidence: Math.max(expertiseResult.confidence, voteResult.confidence),
      method: 'weighted_vote'
    };
  }
  
  // Disagreement: prefer expertise for domain-specific, vote for general
  const isDomainSpecific = ['technology', 'architecture', 'security'].includes(conflict.type);
  
  return isDomainSpecific ? expertiseResult : voteResult;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract sentence containing keyword
 */
function extractRelevantSentence(text: string, keyword: string): string {
  const sentences = text.split(/[.!?]+/);
  const relevant = sentences.find(s => s.toLowerCase().includes(keyword));
  return relevant?.trim() ?? `Contains reference to ${keyword}`;
}

/**
 * Deduplicate similar conflicts
 */
function deduplicateConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const unique: Conflict[] = [];
  
  for (const conflict of conflicts) {
    const key = `${conflict.type}-${conflict.agents.sort().join('-')}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(conflict);
    }
  }
  
  return unique;
}
