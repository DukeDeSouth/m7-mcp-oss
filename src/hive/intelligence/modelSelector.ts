/**
 * M7 Hive v2.0 - Model Selector
 * 
 * Selects the optimal LLM model for each dynamic agent based on:
 * 1. LiveBench baseline scores
 * 2. Self-learning adjustments (when available)
 * 3. Agent domain requirements
 * 
 * @version 3.7.0
 */

import { 
  DynamicAgent, 
  ModelBenchmark, 
  ModelSelection, 
  AgentDomain,
  LearningAdjustment 
} from './types.js';
import { 
  LIVEBENCH_BASELINE, 
  getBestModelForDomain,
  DOMAIN_CATEGORY_MAP 
} from './benchmarkData.js';
import { getLearningAdjustments } from './selfLearning.js';
import { silentLogger as logger } from '../../core/utils/logger.js';

/**
 * Model Selector - Chooses optimal model for each agent
 */
export class ModelSelector {
  private learningAdjustments: Map<string, number> = new Map();
  private initialized: boolean = false;
  
  constructor() {
    this.loadLearningData();
  }
  
  /**
   * Load learning adjustments from self-learning system
   */
  private async loadLearningData(): Promise<void> {
    try {
      const adjustments = await getLearningAdjustments();
      
      for (const adj of adjustments) {
        const key = `${adj.model}:${adj.domain}`;
        this.learningAdjustments.set(key, adj.adjustment);
      }
      
      this.initialized = true;
      logger.info(`[Model Selector] Loaded ${adjustments.length} learning adjustments`);
      
    } catch (error: any) {
      logger.warn(`[Model Selector] Could not load learning data: ${error.message}`);
      this.initialized = true;  // Continue without learning data
    }
  }
  
  /**
   * Select optimal model for a dynamic agent
   */
  selectModelForAgent(agent: DynamicAgent): ModelSelection {
    const domain = agent.domain;
    const scoreKey = DOMAIN_CATEGORY_MAP[domain] || 'global';
    
    // Get all models and apply learning adjustments
    const adjustedModels = this.getAdjustedModels(domain);
    
    // Sort by adjusted score
    const sorted = adjustedModels.sort((a, b) => b.adjustedScore - a.adjustedScore);
    
    const best = sorted[0];
    const alternatives = sorted.slice(1, 4).map(m => ({
      model: m.model.apiName || m.model.model,
      score: m.adjustedScore
    }));
    
    logger.info(`[Model Selector] 🎯 ${agent.role} (${domain}) → ${best.model.model} (score: ${best.adjustedScore.toFixed(1)})`);
    
    return {
      model: best.model.apiName || best.model.model,
      provider: best.model.provider,
      score: best.adjustedScore,
      reasoning: this.generateReasoning(agent, best.model, domain),
      alternatives
    };
  }
  
  /**
   * Get models with learning adjustments applied
   */
  private getAdjustedModels(domain: AgentDomain): Array<{
    model: ModelBenchmark;
    baseScore: number;
    adjustment: number;
    adjustedScore: number;
  }> {
    const scoreKey = DOMAIN_CATEGORY_MAP[domain] || 'global';
    
    return LIVEBENCH_BASELINE.models.map(model => {
      // Get base score for this domain
      const baseScore = (model.scores as any)[scoreKey] ?? model.scores.global;
      
      // Get learning adjustment if available
      const adjustmentKey = `${model.model}:${domain}`;
      const adjustment = this.learningAdjustments.get(adjustmentKey) || 0;
      
      // Apply adjustment (capped at ±20%)
      const cappedAdjustment = Math.max(-20, Math.min(20, adjustment * 100));
      const adjustedScore = baseScore * (1 + cappedAdjustment / 100);
      
      return {
        model,
        baseScore,
        adjustment: cappedAdjustment,
        adjustedScore
      };
    });
  }
  
  /**
   * Generate reasoning for model selection
   */
  private generateReasoning(
    agent: DynamicAgent, 
    model: ModelBenchmark, 
    domain: AgentDomain
  ): string {
    const parts: string[] = [];
    
    parts.push(`Selected ${model.model} (${model.provider}) for "${agent.role}"`);
    
    // Domain match
    const scoreKey = DOMAIN_CATEGORY_MAP[domain] || 'global';
    const score = (model.scores as any)[scoreKey] ?? model.scores.global;
    parts.push(`${domain} score: ${score.toFixed(1)}%`);
    
    // Learning adjustment
    const adjustmentKey = `${model.model}:${domain}`;
    const adjustment = this.learningAdjustments.get(adjustmentKey);
    if (adjustment && adjustment !== 0) {
      const direction = adjustment > 0 ? '+' : '';
      parts.push(`self-learning adjustment: ${direction}${(adjustment * 100).toFixed(1)}%`);
    }
    
    // Tier info
    parts.push(`tier: ${model.tier}`);
    
    return parts.join(', ');
  }
  
  /**
   * Select models for entire team
   */
  selectModelsForTeam(agents: DynamicAgent[]): Map<string, ModelSelection> {
    const selections = new Map<string, ModelSelection>();
    
    for (const agent of agents) {
      const selection = this.selectModelForAgent(agent);
      selections.set(agent.id, selection);
    }
    
    // Log team composition
    logger.info(`[Model Selector] 📋 Team model assignments:`);
    for (const agent of agents) {
      const sel = selections.get(agent.id)!;
      logger.info(`  - ${agent.role}: ${sel.model} (${sel.provider})`);
    }
    
    return selections;
  }
  
  /**
   * Get current benchmark data version
   */
  getBenchmarkVersion(): string {
    return LIVEBENCH_BASELINE.version;
  }
  
  /**
   * Check if learning data is loaded
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create Model Selector instance
 */
export function createModelSelector(): ModelSelector {
  return new ModelSelector();
}

/**
 * Quick selection without instantiating
 */
export function selectModel(agent: DynamicAgent): ModelSelection {
  const selector = new ModelSelector();
  return selector.selectModelForAgent(agent);
}
