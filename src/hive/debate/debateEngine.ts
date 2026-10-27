/**
 * M7 Hive Debate Engine
 * 
 * Real LLM-powered debates between Hive agents.
 * Each round: agents critique each other via LLM → agents refine via LLM → convergence check via LLM.
 * Uses FLAGSHIP models only (Opus 4.6, GPT-5.2) for maximum reasoning quality.
 * Cross-provider: critiques via Anthropic, refinements via OpenAI, convergence via Anthropic.
 * 
 * @version 1.1.0
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { HiveTask } from '../types/task.js';
import { DynamicAgent, DynamicAgentProposal } from '../intelligence/types.js';
import {
  DebateConfig,
  DEFAULT_DEBATE_CONFIG,
  DebateResult,
  DebateRoundResult,
  LLMCritique,
  CritiqueVerdict
} from './types.js';
import { robustParse } from '../utils/json/index.js';
import { silentLogger as logger } from '../../core/utils/logger.js';

// Valid critique verdicts for validation
const VALID_VERDICTS: CritiqueVerdict[] = ['CONFIRM', 'REFINE', 'CONTEST', 'INSUFFICIENT'];

// Cost per 1K tokens for debate models (flagships, April 2026)
const DEBATE_COST_RATES: Record<string, number> = {
  // Anthropic flagships
  'claude-opus-4-7': 0.015 / 1000,
  'claude-opus-4-6': 0.015 / 1000,
  // OpenAI flagships
  'gpt-5.5': 0.0175 / 1000,
  'gpt-5.5-2026-04-23': 0.0175 / 1000,
  'gpt-5.2': 0.0078 / 1000,
};

/**
 * Detect provider from model name.
 * Models starting with 'claude' → anthropic, otherwise → openai.
 */
function detectProvider(model: string): 'openai' | 'anthropic' {
  if (model.startsWith('claude')) return 'anthropic';
  return 'openai';
}

export class DebateEngine {
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;
  
  constructor(openai: OpenAI, anthropic: Anthropic) {
    this.openaiClient = openai;
    this.anthropicClient = anthropic;
  }
  
  /**
   * Run a full debate between agents.
   * 
   * Each round:
   * 1. Agents critique each other (parallel LLM calls)
   * 2. Agents refine their proposals based on critiques (parallel LLM calls)
   * 3. Convergence check (single cheap LLM call)
   * 
   * Stops when: convergence reached, max rounds hit, or budget exhausted.
   */
  async debate(
    proposals: DynamicAgentProposal[],
    task: HiveTask,
    config: Partial<DebateConfig> = {}
  ): Promise<DebateResult> {
    const cfg: DebateConfig = { ...DEFAULT_DEBATE_CONFIG, ...config };
    const startTime = Date.now();
    
    // Calculate budget cap from initial proposal cost
    const initialCost = proposals.reduce((sum, p) => sum + p.metrics.costEstimate, 0);
    const budgetCap = Math.max(initialCost * cfg.budgetCapMultiplier, 0.01); // Min $0.01
    
    let currentProposals = proposals;
    let totalCost = 0;
    let totalTokens = 0;
    const rounds: DebateRoundResult[] = [];
    let stoppedReason: DebateResult['stoppedReason'] = 'max_rounds';
    
    logger.info(
      `[Debate] 🗣️ Starting: ${proposals.length} agents, ` +
      `max ${cfg.maxRounds} rounds, budget $${budgetCap.toFixed(4)}`
    );
    
    for (let round = 1; round <= cfg.maxRounds; round++) {
      const roundStart = Date.now();
      
      // Budget check at start of each round
      if (totalCost >= budgetCap) {
        logger.info(`[Debate] 💰 Budget cap reached ($${totalCost.toFixed(4)} >= $${budgetCap.toFixed(4)})`);
        stoppedReason = 'budget_cap';
        break;
      }
      
      // === Step 1: Generate critiques (parallel) ===
      const critiquePairs = this.selectCritiquePairs(currentProposals);
      const critiques = await this.generateCritiques(critiquePairs, currentProposals, task, cfg);
      
      const critiqueCost = this.estimateCost(cfg.critiqueModel, critiques.length * 500);
      totalCost += critiqueCost;
      totalTokens += critiques.length * 500;
      
      // Log critique summary
      const verdictCounts = this.countVerdicts(critiques);
      logger.info(
        `[Debate] Round ${round} critiques: ` +
        `${verdictCounts.CONFIRM} CONFIRM, ${verdictCounts.REFINE} REFINE, ` +
        `${verdictCounts.CONTEST} CONTEST, ${verdictCounts.INSUFFICIENT} INSUFFICIENT`
      );
      
      // === Step 2: Refine proposals (parallel) ===
      const refinedProposals = await this.refineProposals(
        currentProposals, critiques, task, cfg
      );
      
      const refineCost = this.estimateCost(cfg.refineModel, refinedProposals.length * 800);
      totalCost += refineCost;
      totalTokens += refinedProposals.length * 800;
      
      // === Step 3: Check convergence ===
      const convergence = await this.checkConvergence(
        currentProposals, refinedProposals, task, cfg
      );
      
      const convergenceCost = this.estimateCost(cfg.convergenceModel, 300);
      totalCost += convergenceCost;
      totalTokens += 300;
      
      // Record round
      const roundResult: DebateRoundResult = {
        roundNumber: round,
        critiques,
        refinedProposals,
        convergenceScore: convergence.score,
        convergenceDirection: convergence.direction,
        cost: critiqueCost + refineCost + convergenceCost,
        latencyMs: Date.now() - roundStart
      };
      
      rounds.push(roundResult);
      currentProposals = refinedProposals;
      
      logger.info(
        `[Debate] Round ${round} done: convergence=${convergence.score.toFixed(2)}, ` +
        `direction=${convergence.direction}, cost=$${roundResult.cost.toFixed(4)}, ` +
        `${roundResult.latencyMs}ms`
      );
      
      // Early exit on convergence
      if (convergence.score >= cfg.convergenceThreshold) {
        stoppedReason = 'converged';
        logger.info(`[Debate] ✅ Converged at round ${round}`);
        break;
      }
    }
    
    const totalLatencyMs = Date.now() - startTime;
    logger.info(
      `[Debate] 🏁 Complete: ${rounds.length} rounds, ` +
      `converged=${stoppedReason === 'converged'}, ` +
      `cost=$${totalCost.toFixed(4)}, ${totalLatencyMs}ms`
    );
    
    return {
      rounds,
      finalProposals: currentProposals,
      converged: stoppedReason === 'converged',
      convergenceScore: rounds.length > 0 ? rounds[rounds.length - 1].convergenceScore : 0,
      totalRounds: rounds.length,
      totalCost,
      totalTokens,
      totalLatencyMs,
      stoppedReason
    };
  }
  
  // ============================================================================
  // CRITIQUE GENERATION
  // ============================================================================
  
  /**
   * Select which agents critique which.
   * For ≤3 agents: full round-robin.
   * For >3 agents: each critiques 2 others (adjacent + skip-one).
   */
  private selectCritiquePairs(
    proposals: DynamicAgentProposal[]
  ): [number, number][] {
    const pairs: [number, number][] = [];
    const n = proposals.length;
    
    if (n <= 3) {
      // Full round-robin
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i !== j) pairs.push([i, j]);
        }
      }
    } else {
      // Each agent critiques 2 others
      for (let i = 0; i < n; i++) {
        pairs.push([i, (i + 1) % n]);
        pairs.push([i, (i + 2) % n]);
      }
    }
    
    return pairs;
  }
  
  /**
   * Generate LLM-based critiques in parallel.
   */
  private async generateCritiques(
    pairs: [number, number][],
    proposals: DynamicAgentProposal[],
    task: HiveTask,
    cfg: DebateConfig
  ): Promise<LLMCritique[]> {
    const promises = pairs.map(([criticIdx, targetIdx]) =>
      this.generateSingleCritique(proposals[criticIdx], proposals[targetIdx], task, cfg)
    );
    
    const results = await Promise.allSettled(promises);
    
    const critiques: LLMCritique[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        critiques.push(result.value);
      } else {
        logger.warn(`[Debate] Critique failed: ${result.reason?.message || result.reason}`);
      }
    }
    
    return critiques;
  }
  
  /**
   * Generate a single critique via LLM.
   */
  private async generateSingleCritique(
    critic: DynamicAgentProposal,
    target: DynamicAgentProposal,
    task: HiveTask,
    cfg: DebateConfig
  ): Promise<LLMCritique> {
    const systemPrompt = [
      `You are ${critic.agent.role}, expert in ${critic.agent.expertise}.`,
      `Evaluate another expert's proposal with calibrated honesty.`,
      `- CONFIRM: well-supported, explain why it holds`,
      `- REFINE: partially right, specify what to improve`,
      `- CONTEST: unsupported, provide counter-evidence`,
      `- INSUFFICIENT: not enough data to evaluate`,
      `You are rewarded for accuracy, not for finding flaws.`,
      `If the proposal is better than yours in some aspects, say so.`
    ].join('\n');

    const userPrompt = [
      `## Task\n${task.description.substring(0, 500)}`,
      ``,
      `## Proposal by ${target.agent.role}:`,
      target.proposal.substring(0, 800),
      ``,
      `Reasoning: ${target.reasoning.substring(0, 300)}`,
      `Confidence: ${(target.confidence * 100).toFixed(0)}%`,
      target.keyAssumptions?.length ? `Key assumptions: ${target.keyAssumptions.join('; ')}` : '',
      ``,
      `## Your Position (for reference):`,
      critic.proposal.substring(0, 400),
      ``,
      `Respond JSON: {"verdict":"CONFIRM|REFINE|CONTEST|INSUFFICIENT","reasoning":"why","confidence":0.7,"suggested_changes":"if REFINE"}`
    ].filter(Boolean).join('\n');

    const content = await this.callLLM(cfg.critiqueModel, systemPrompt, userPrompt, 800);
    const parsed = robustParse(content);
    
    const data = (parsed.success ? parsed.data : {}) as Record<string, any>;
    
    return {
      criticAgent: critic.agent,
      targetAgent: target.agent,
      verdict: VALID_VERDICTS.includes(data.verdict) ? data.verdict : 'INSUFFICIENT',
      reasoning: data.reasoning || content.substring(0, 500),
      confidence: typeof data.confidence === 'number' 
        ? Math.max(0, Math.min(1, data.confidence)) 
        : 0.5,
      suggestedChanges: data.suggested_changes || undefined
    };
  }
  
  // ============================================================================
  // PROPOSAL REFINEMENT
  // ============================================================================
  
  /**
   * Ask agents to revise proposals based on critiques (parallel).
   */
  private async refineProposals(
    proposals: DynamicAgentProposal[],
    critiques: LLMCritique[],
    task: HiveTask,
    cfg: DebateConfig
  ): Promise<DynamicAgentProposal[]> {
    const promises = proposals.map(proposal => {
      const myCritiques = critiques.filter(c => c.targetAgent.id === proposal.agent.id);
      
      // No critiques received → keep original
      if (myCritiques.length === 0) {
        return Promise.resolve(proposal);
      }
      
      // All CONFIRM → keep original (no need to change)
      if (myCritiques.every(c => c.verdict === 'CONFIRM')) {
        return Promise.resolve(proposal);
      }
      
      return this.refineSingleProposal(proposal, myCritiques, task, cfg);
    });
    
    const results = await Promise.allSettled(promises);
    
    return results.map((r, i) => 
      r.status === 'fulfilled' ? r.value : proposals[i]
    );
  }
  
  /**
   * Refine a single proposal via LLM based on received critiques.
   */
  private async refineSingleProposal(
    proposal: DynamicAgentProposal,
    critiques: LLMCritique[],
    task: HiveTask,
    cfg: DebateConfig
  ): Promise<DynamicAgentProposal> {
    const critiqueText = critiques.map(c =>
      [
        `${c.criticAgent.role} (${c.verdict}): ${c.reasoning.substring(0, 300)}`,
        c.suggestedChanges ? `  Suggestion: ${c.suggestedChanges.substring(0, 200)}` : ''
      ].filter(Boolean).join('\n')
    ).join('\n\n');
    
    const systemPrompt = [
      `You are ${proposal.agent.role}, expert in ${proposal.agent.expertise}.`,
      `Revise your proposal based on peer critiques.`,
      `- Accept valid criticism and update your position`,
      `- Defend well-supported points with clear reasoning`,
      `- Update confidence honestly — it can go up or down`,
      `- If nothing needs changing, explain why`
    ].join('\n');

    const userPrompt = [
      `## Task\n${task.description.substring(0, 300)}`,
      ``,
      `## Your Current Proposal:`,
      proposal.proposal.substring(0, 800),
      `Confidence: ${(proposal.confidence * 100).toFixed(0)}%`,
      ``,
      `## Peer Critiques:`,
      critiqueText,
      ``,
      `Revise. Respond JSON:`,
      `{"proposal":"revised","reasoning":"updated","confidence":0.75,"key_assumptions":["updated"],"changes_from_original":"what changed"}`
    ].join('\n');

    try {
      const content = await this.callLLM(cfg.refineModel, systemPrompt, userPrompt, 1500);
      const parsed = robustParse(content);
      
      if (!parsed.success) {
        logger.warn(`[Debate] Refinement parse failed for ${proposal.agent.role}, keeping original`);
        return proposal;
      }
      
      const data = parsed.data as Record<string, any>;
      
      return {
        ...proposal,
        proposal: typeof data.proposal === 'string' ? data.proposal : proposal.proposal,
        reasoning: typeof data.reasoning === 'string' ? data.reasoning : proposal.reasoning,
        confidence: typeof data.confidence === 'number'
          ? Math.max(0, Math.min(1, data.confidence))
          : proposal.confidence,
        keyAssumptions: Array.isArray(data.key_assumptions) 
          ? data.key_assumptions 
          : proposal.keyAssumptions,
      };
    } catch (error: any) {
      logger.warn(`[Debate] Refinement failed for ${proposal.agent.role}: ${error.message}`);
      return proposal; // Fallback: keep original
    }
  }
  
  // ============================================================================
  // CONVERGENCE CHECK
  // ============================================================================
  
  /**
   * Check convergence between rounds via cheap LLM call.
   */
  private async checkConvergence(
    previousProposals: DynamicAgentProposal[],
    currentProposals: DynamicAgentProposal[],
    task: HiveTask,
    cfg: DebateConfig
  ): Promise<{ score: number; direction: 'converging' | 'diverging' | 'stable' }> {
    const prevSummary = previousProposals.map(p =>
      `${p.agent.role}: ${p.proposal.substring(0, 200)} (conf: ${(p.confidence * 100).toFixed(0)}%)`
    ).join('\n');
    
    const currSummary = currentProposals.map(p =>
      `${p.agent.role}: ${p.proposal.substring(0, 200)} (conf: ${(p.confidence * 100).toFixed(0)}%)`
    ).join('\n');
    
    try {
      const convergencePrompt = `Compare two rounds of expert proposals. How much did positions change?

## Previous Round:
${prevSummary}

## Current Round:
${currSummary}

Respond JSON only: {"convergence_score":0.85,"direction":"converging|diverging|stable"}`;

      const content = await this.callLLM(
        cfg.convergenceModel,
        'You are a debate convergence judge. Assess how much expert positions changed between rounds.',
        convergencePrompt,
        300
      );
      
      const parsed = robustParse(content);
      const data = (parsed.success ? parsed.data : {}) as Record<string, any>;
      
      const validDirections = ['converging', 'diverging', 'stable'] as const;
      
      return {
        score: typeof data.convergence_score === 'number'
          ? Math.max(0, Math.min(1, data.convergence_score))
          : 0.5,
        direction: validDirections.includes(data.direction) ? data.direction : 'stable'
      };
    } catch (error: any) {
      logger.warn(`[Debate] Convergence check failed: ${error.message}, using fallback`);
      return this.fallbackConvergenceCheck(previousProposals, currentProposals);
    }
  }
  
  /**
   * Fallback convergence check (no LLM) — compares confidence deltas.
   */
  private fallbackConvergenceCheck(
    previous: DynamicAgentProposal[],
    current: DynamicAgentProposal[]
  ): { score: number; direction: 'converging' | 'diverging' | 'stable' } {
    let totalConfDelta = 0;
    
    for (let i = 0; i < previous.length; i++) {
      const prev = previous[i];
      const curr = current.find(p => p.agent.id === prev.agent.id);
      if (curr) {
        totalConfDelta += Math.abs(curr.confidence - prev.confidence);
      }
    }
    
    const avgDelta = totalConfDelta / Math.max(previous.length, 1);
    
    // Low delta = high convergence
    const score = Math.max(0, 1 - avgDelta * 5);
    
    return {
      score,
      direction: avgDelta < 0.05 ? 'stable' : avgDelta < 0.15 ? 'converging' : 'diverging'
    };
  }
  
  // ============================================================================
  // UNIFIED LLM CALLER (supports both providers)
  // ============================================================================
  
  /**
   * Call LLM with auto-detection of provider from model name.
   * Claude models → Anthropic, GPT models → OpenAI.
   */
  private async callLLM(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number
  ): Promise<string> {
    const provider = detectProvider(model);
    
    if (provider === 'anthropic') {
      const response = await this.anthropicClient.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
      return response.content[0].type === 'text' ? response.content[0].text : '';
    } else {
      const isGPT5 = model.startsWith('gpt-5');
      const params: any = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };
      // GPT-5 reasoning models: use max_completion_tokens (includes CoT overhead)
      if (isGPT5) {
        params.max_completion_tokens = maxTokens;
      } else {
        params.max_tokens = maxTokens;
        params.temperature = 0.3;
      }
      const response = await this.openaiClient.chat.completions.create(params);
      return response.choices[0].message.content || '';
    }
  }
  
  // ============================================================================
  // HELPERS
  // ============================================================================
  
  private estimateCost(model: string, tokens: number): number {
    const rate = DEBATE_COST_RATES[model] || 0.008 / 1000; // Default: flagship tier
    return rate * tokens;
  }
  
  private countVerdicts(critiques: LLMCritique[]): Record<CritiqueVerdict, number> {
    const counts: Record<CritiqueVerdict, number> = {
      CONFIRM: 0,
      REFINE: 0,
      CONTEST: 0,
      INSUFFICIENT: 0
    };
    
    for (const c of critiques) {
      counts[c.verdict]++;
    }
    
    return counts;
  }
}
