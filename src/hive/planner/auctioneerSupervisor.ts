/**
 * M7 Hive v3.0 - Auctioneer Supervisor
 * 
 * Manages CNP auctions for task allocation using market-based
 * coordination with fairness constraints.
 * 
 * @version 3.8.0
 */

import { randomUUID } from 'crypto';
import {
  CNPTask,
  CNPBid,
  CNPAward,
  CNPScoreBreakdown,
  CNPScoringWeights,
  BiddableAgent,
  PlannerOptions,
  DEFAULT_PLANNER_OPTIONS,
  SCORING_WEIGHT_PRESETS,
  getWeightsForTaskType
} from './types.js';
import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[Auctioneer]');

/**
 * Auctioneer Supervisor - Manages task auctions
 */
export class AuctioneerSupervisor {
  private options: PlannerOptions;
  
  // Agent tracking for fairness
  private agentWinCounts: Map<string, number> = new Map();
  private agentLoads: Map<string, number> = new Map();
  private agentTrustScores: Map<string, number> = new Map();
  
  // Bid accuracy tracking for calibration
  private bidAccuracyHistory: Map<string, { estimated: number; actual: number }[]> = new Map();
  
  constructor(options: Partial<PlannerOptions> = {}) {
    this.options = { ...DEFAULT_PLANNER_OPTIONS, ...options };
    log.info('[Auctioneer] ✅ Initialized');
  }
  
  /**
   * Run auction for a task
   */
  async runAuction(
    task: CNPTask,
    agents: BiddableAgent[],
    getBid: (agent: BiddableAgent, task: CNPTask) => Promise<CNPBid | null>
  ): Promise<CNPAward> {
    
    const auctionId = `auction_${randomUUID()}`;
    log.info(`[Auctioneer] 🎯 Starting auction ${auctionId} for task: ${task.description.substring(0, 50)}...`);
    
    // 1. Filter eligible agents
    log.debug(`[Auctioneer] 🔍 Filtering ${agents.length} agents for task: ${task.description.substring(0, 30)}...`);
    const eligibleAgents = agents.filter(a => this.isEligible(a, task));
    log.debug(`[Auctioneer] 👥 ${eligibleAgents.length}/${agents.length} agents eligible`);
    log.info(`[Auctioneer] 👥 ${eligibleAgents.length}/${agents.length} agents eligible`);
    
    if (eligibleAgents.length === 0) {
      log.debug(`[Auctioneer] ❌ NO ELIGIBLE AGENTS! Task constraints: ${JSON.stringify(task.constraints)}`);
      throw new Error(`No eligible agents for task: ${task.id}`);
    }
    
    // 2. Fast-track if only one eligible agent
    if (this.options.fastTrackSimpleTasks && eligibleAgents.length === 1) {
      log.info('[Auctioneer] ⚡ Fast-tracking single eligible agent');
      return this.createFastTrackAward(task, eligibleAgents[0]);
    }
    
    // 3. Collect bids
    task.state = 'BIDDING';
    const bids = await this.collectBids(task, eligibleAgents, getBid);
    
    if (bids.length < this.options.minBidsRequired) {
      throw new Error(`Insufficient bids: ${bids.length}/${this.options.minBidsRequired}`);
    }
    
    log.info(`[Auctioneer] 📥 Collected ${bids.length} bids`);
    
    // 4. Score bids
    const weights = this.getWeightsForTask(task);
    const scoredBids = this.scoreBids(bids, task, weights);
    
    // 5. Select winner
    const winner = this.selectWinner(scoredBids);
    
    // 6. Create award
    const award = this.createAward(task, winner, scoredBids);
    
    // 7. Update tracking
    this.updateAgentTracking(winner.bid.agentId);
    
    log.info(`[Auctioneer] 🏆 Winner: ${winner.bid.agentRole} (score: ${winner.scores.total.toFixed(3)})`);
    
    return award;
  }
  
  /**
   * Check if agent is eligible for task
   * Note: For dynamically generated agents, we skip capability matching
   * since they are created specifically for the task.
   */
  private isEligible(agent: BiddableAgent, task: CNPTask): boolean {
    // Check exclusion list
    if (task.constraints.excludeAgents?.includes(agent.id)) {
      return false;
    }
    
    // Skip capability check for dynamic agents
    // Dynamic agents are created by HiveArchitect specifically for the task
    // Their domains may not match generic capability names like "coding"
    // Instead, trust that the Architect created relevant agents
    
    // Check load
    if (agent.currentLoad >= 1.0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Collect bids from agents with timeout
   */
  private async collectBids(
    task: CNPTask,
    agents: BiddableAgent[],
    getBid: (agent: BiddableAgent, task: CNPTask) => Promise<CNPBid | null>
  ): Promise<CNPBid[]> {
    
    const timeout = task.auctionDeadline || this.options.auctionTimeoutMs;
    
    const bidPromises = agents.map(async agent => {
      try {
        const bid = await Promise.race([
          getBid(agent, task),
          new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), timeout)
          )
        ]);
        return bid;
      } catch (error: any) {
        log.warn(`[Auctioneer] Bid failed from ${agent.role}: ${error.message}`);
        return null;
      }
    });
    
    const results = await Promise.all(bidPromises);
    return results.filter((b): b is CNPBid => b !== null);
  }
  
  /**
   * Get scoring weights for task type
   */
  private getWeightsForTask(task: CNPTask): CNPScoringWeights {
    // Check for security-related tasks
    const isSecurityTask = 
      task.description.toLowerCase().includes('security') ||
      task.description.toLowerCase().includes('auth') ||
      task.constraints.requiredCapabilities?.includes('security');
    
    if (isSecurityTask) {
      return SCORING_WEIGHT_PRESETS.security;
    }
    
    // Check for review tasks
    if (task.type === 'review') {
      return SCORING_WEIGHT_PRESETS.review;
    }
    
    // Check for coding tasks
    const isCodingTask =
      task.description.toLowerCase().includes('implement') ||
      task.description.toLowerCase().includes('code') ||
      task.constraints.requiredCapabilities?.includes('coding');
    
    if (isCodingTask) {
      return SCORING_WEIGHT_PRESETS.coding;
    }
    
    return this.options.weights;
  }
  
  /**
   * Score all bids
   */
  private scoreBids(
    bids: CNPBid[],
    task: CNPTask,
    weights: CNPScoringWeights
  ): Array<{ bid: CNPBid; scores: CNPScoreBreakdown }> {
    
    // Find min/max for normalization
    const costs = bids.map(b => b.estimatedCost);
    const times = bids.map(b => b.estimatedTime);
    
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    return bids.map(bid => {
      // Normalize scores (0-1, higher is better)
      const costScore = maxCost > minCost 
        ? 1 - (bid.estimatedCost - minCost) / (maxCost - minCost)
        : 1;
      
      const timeScore = maxTime > minTime
        ? 1 - (bid.estimatedTime - minTime) / (maxTime - minTime)
        : 1;
      
      const confidenceScore = bid.confidence;
      
      const fairnessScore = this.calculateFairnessScore(bid.agentId);
      
      const trustScore = this.getTrustScore(bid.agentId);
      
      // Apply calibration if we have history
      const calibratedCost = this.calibrateBid(bid.agentId, bid.estimatedCost);
      const calibrationBonus = bid.estimatedCost > 0 
        ? Math.min(0.1, Math.abs(1 - calibratedCost / bid.estimatedCost) * 0.5)
        : 0;
      
      // Calculate weighted total
      const total = 
        costScore * weights.cost +
        timeScore * weights.time +
        confidenceScore * weights.confidence +
        fairnessScore * weights.fairness +
        trustScore * weights.trust +
        calibrationBonus; // Small bonus for accurate bidders
      
      return {
        bid,
        scores: {
          cost: costScore,
          time: timeScore,
          confidence: confidenceScore,
          fairness: fairnessScore,
          trust: trustScore,
          total: Math.min(1, total) // Cap at 1
        }
      };
    });
  }
  
  /**
   * Calculate fairness score (penalize frequent winners)
   */
  private calculateFairnessScore(agentId: string): number {
    if (!this.options.loadBalancingEnabled) return 1;
    
    const wins = this.agentWinCounts.get(agentId) || 0;
    const maxWins = this.options.maxConsecutiveWins;
    
    // Exponential decay penalty
    return Math.exp(-wins / maxWins);
  }
  
  /**
   * Get trust score from history
   */
  private getTrustScore(agentId: string): number {
    const score = this.agentTrustScores.get(agentId);
    return score ?? 0.7; // Default neutral
  }
  
  /**
   * Calibrate bid based on historical accuracy
   */
  private calibrateBid(agentId: string, estimatedCost: number): number {
    const history = this.bidAccuracyHistory.get(agentId);
    if (!history || history.length < 3) return estimatedCost;
    
    // Calculate average ratio
    const avgRatio = history.reduce((sum, h) => 
      sum + h.actual / h.estimated, 0) / history.length;
    
    return estimatedCost * avgRatio;
  }
  
  /**
   * Select winner from scored bids
   */
  private selectWinner(
    scoredBids: Array<{ bid: CNPBid; scores: CNPScoreBreakdown }>
  ): { bid: CNPBid; scores: CNPScoreBreakdown } {
    
    const sorted = [...scoredBids].sort((a, b) => b.scores.total - a.scores.total);
    return sorted[0];
  }
  
  /**
   * Create fast-track award for single eligible agent
   */
  private createFastTrackAward(task: CNPTask, agent: BiddableAgent): CNPAward {
    const now = new Date().toISOString();
    
    return {
      taskId: task.id,
      winnerId: agent.id,
      winnerRole: agent.role,
      winningBid: {
        id: `bid_fasttrack_${randomUUID()}`,
        taskId: task.id,
        agentId: agent.id,
        agentRole: agent.role,
        estimatedCost: 0,
        estimatedTime: 0,
        confidence: 1,
        approach: 'Fast-tracked (single eligible agent)',
        risks: [],
        submittedAt: now
      },
      scoreBreakdown: {
        cost: 1,
        time: 1,
        confidence: 1,
        fairness: 1,
        trust: this.getTrustScore(agent.id),
        total: 1
      },
      reason: 'Fast-tracked: only eligible agent',
      otherBids: [],
      timestamp: now
    };
  }
  
  /**
   * Create award from winner
   */
  private createAward(
    task: CNPTask,
    winner: { bid: CNPBid; scores: CNPScoreBreakdown },
    allScoredBids: Array<{ bid: CNPBid; scores: CNPScoreBreakdown }>
  ): CNPAward {
    
    const otherBids = allScoredBids
      .filter(sb => sb.bid.agentId !== winner.bid.agentId)
      .map(sb => ({
        agentId: sb.bid.agentId,
        score: sb.scores.total,
        reason: this.generateRejectionReason(sb.scores, winner.scores)
      }));
    
    return {
      taskId: task.id,
      winnerId: winner.bid.agentId,
      winnerRole: winner.bid.agentRole,
      winningBid: winner.bid,
      scoreBreakdown: winner.scores,
      reason: this.generateWinReason(winner.scores),
      otherBids,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Generate human-readable win reason
   */
  private generateWinReason(scores: CNPScoreBreakdown): string {
    const factors: Array<[string, number]> = [
      ['cost efficiency', scores.cost],
      ['speed', scores.time],
      ['confidence', scores.confidence],
      ['fairness', scores.fairness],
      ['trust', scores.trust]
    ];
    
    const topFactor = factors.sort((a, b) => b[1] - a[1])[0];
    
    return `Selected for best overall score (${scores.total.toFixed(2)}), ` +
           `particularly strong in ${topFactor[0]} (${topFactor[1].toFixed(2)})`;
  }
  
  /**
   * Generate rejection reason
   */
  private generateRejectionReason(
    loserScores: CNPScoreBreakdown,
    winnerScores: CNPScoreBreakdown
  ): string {
    const diff = winnerScores.total - loserScores.total;
    
    if (diff > 0.3) {
      return 'Significantly lower overall score';
    } else if (loserScores.confidence < winnerScores.confidence - 0.2) {
      return 'Lower confidence';
    } else if (loserScores.trust < winnerScores.trust - 0.1) {
      return 'Lower trust score';
    } else {
      return `Outscored by ${(diff * 100).toFixed(1)}%`;
    }
  }
  
  /**
   * Update agent tracking after award
   */
  private updateAgentTracking(winnerId: string): void {
    // Increment win count
    const wins = this.agentWinCounts.get(winnerId) || 0;
    this.agentWinCounts.set(winnerId, wins + 1);
    
    // Reset others (consecutive wins)
    for (const [id] of this.agentWinCounts) {
      if (id !== winnerId) {
        this.agentWinCounts.set(id, 0);
      }
    }
  }
  
  /**
   * Record actual execution results for learning
   */
  recordExecution(
    agentId: string,
    estimatedCost: number,
    actualCost: number,
    success: boolean
  ): void {
    // Update bid accuracy history
    const history = this.bidAccuracyHistory.get(agentId) || [];
    history.push({ estimated: estimatedCost, actual: actualCost });
    
    // Keep last 20 entries
    if (history.length > 20) {
      history.shift();
    }
    this.bidAccuracyHistory.set(agentId, history);
    
    // Update trust score
    const currentTrust = this.agentTrustScores.get(agentId) || 0.7;
    const adjustment = success ? 0.02 : -0.05;
    const newTrust = Math.max(0.1, Math.min(1, currentTrust + adjustment));
    this.agentTrustScores.set(agentId, newTrust);
    
    log.info(`[Auctioneer] 📊 Updated ${agentId}: trust=${newTrust.toFixed(2)}`);
  }
  
  /**
   * Reset tracking for new goal
   */
  reset(): void {
    this.agentWinCounts.clear();
    this.agentLoads.clear();
    log.info('[Auctioneer] 🔄 Reset tracking');
  }
  
  /**
   * Get current statistics
   */
  getStats(): {
    agentWins: Record<string, number>;
    agentTrust: Record<string, number>;
  } {
    return {
      agentWins: Object.fromEntries(this.agentWinCounts),
      agentTrust: Object.fromEntries(this.agentTrustScores)
    };
  }
}

/**
 * Create Auctioneer Supervisor instance
 */
export function createAuctioneerSupervisor(
  options?: Partial<PlannerOptions>
): AuctioneerSupervisor {
  return new AuctioneerSupervisor(options);
}
