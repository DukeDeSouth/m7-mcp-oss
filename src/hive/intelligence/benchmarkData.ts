/**
 * M7 Hive v2.0 - LiveBench Baseline Data
 * 
 * Hardcoded benchmark data from LiveBench (https://livebench.ai)
 * Updated: 2026-04-30 (Vellum LLM Leaderboard 2026-04-23 + Anthropic/OpenAI official docs)
 * 
 * This data is used for model selection until self-learning
 * accumulates enough data to make adjustments.
 * 
 * @version 3.7.0
 */

import { BenchmarkBaseline, ModelBenchmark, AgentDomain } from './types.js';

/**
 * LiveBench baseline data
 * Source: https://livebench.ai (LiveBench-2026-01-08)
 * 
 * Scores are percentages (0-100)
 * Categories: Reasoning, Coding, Math, Data Analysis, Language, IF (Instruction Following)
 */
export const LIVEBENCH_BASELINE: BenchmarkBaseline = {
  version: '2026-04-23',
  source: 'https://www.vellum.ai/llm-leaderboard',
  lastUpdated: '2026-04-30',
  
  models: [
    // ========================================================================
    // ANTHROPIC MODELS (Updated April 2026)
    // ========================================================================
    
    // Claude Opus 4.7 — Current Flagship (Adaptive Thinking, 1M context, 128K output)
    // Released: 2026-04-16. SWE-Bench 87.6%, GPQA 94.2%.
    {
      model: 'claude-opus-4-7',
      provider: 'anthropic',
      tier: 'flagship',
      apiName: 'claude-opus-4-7',
      scores: {
        global: 85.50,
        reasoning: 94.20,    // GPQA Diamond 94.2%
        coding: 93.80,       // SWE-Bench 87.6% (best agentic coding)
        math: 99.80,         // AIME 2025 99.8% (estimated from Opus 4.6)
        data: 82.00,
        language: 89.30,     // MMMLU 89.3% (from Vellum)
        security: 95,
        architecture: 92
      }
    },
    
    // Claude Opus 4.6 — Previous Flagship (Adaptive Thinking, 1M context)
    {
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      tier: 'flagship',
      apiName: 'claude-opus-4-6',
      scores: {
        global: 82.10,
        reasoning: 87.50,
        coding: 88.90,
        math: 99.80,         // AIME 2025 99.8%
        data: 80.15,
        language: 91.10,     // MMMLU 91.1%
        security: 92,
        architecture: 88
      }
    },
    
    // Claude Sonnet 4.6 — Current Standard (Adaptive Thinking, 1M context, 64K output)
    {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tier: 'standard',
      apiName: 'claude-sonnet-4-6',
      scores: {
        global: 74.50,
        reasoning: 82.00,
        coding: 85.20,
        math: 88.00,
        data: 65.00,
        language: 89.30,     // MMMLU 89.3%
        security: 82,
        architecture: 80
      }
    },
    
    // Claude Sonnet 4.5 — Previous Standard
    {
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      tier: 'standard',
      apiName: 'claude-sonnet-4-5-20250929',
      scores: {
        global: 72.00,
        reasoning: 77.59,
        coding: 82.00,       // SWE-Bench 82%
        math: 79.31,
        data: 56.97,
        language: 76.45,
        security: 78,
        architecture: 75
      }
    },
    
    // Claude Opus 4.5 — Previous Flagship
    {
      model: 'claude-opus-4-5',
      provider: 'anthropic',
      tier: 'flagship',
      apiName: 'claude-opus-4-5-20251101',
      scores: {
        global: 75.96,
        reasoning: 80.09,
        coding: 80.90,       // SWE-Bench 80.9%
        math: 90.39,
        data: 74.44,
        language: 90.80,     // MMMLU 90.8%
        security: 85,
        architecture: 82
      }
    },
    
    // Claude Haiku 4.5 — Economy
    {
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      tier: 'economy',
      apiName: 'claude-haiku-4-5-20251001',
      scores: {
        global: 61.32,
        reasoning: 61.68,
        coding: 72.81,
        math: 77.53,
        data: 59.30,
        language: 66.45,
        security: 65,
        architecture: 62
      }
    },
    
    // ========================================================================
    // OPENAI MODELS (Updated April 2026)
    // ========================================================================
    
    // GPT-5.5 — Current Flagship (Reasoning, 1.05M context, 128K output)
    // Released: 2026-04-23. GPQA 93.6%, ARC-AGI 2 85%.
    {
      model: 'gpt-5.5',
      provider: 'openai',
      tier: 'flagship',
      apiName: 'gpt-5.5',
      scores: {
        global: 86.00,
        reasoning: 93.60,    // GPQA Diamond 93.6%
        coding: 88.50,       // SWE-Bench 58.6% but strong LiveCodeBench
        math: 96.00,
        data: 85.00,         // ARC-AGI 2 85% (visual reasoning)
        language: 88.00,
        security: 88,
        architecture: 90
      }
    },
    
    // GPT-5.2 — Previous Flagship
    {
      model: 'gpt-5.2',
      provider: 'openai',
      tier: 'flagship',
      apiName: 'gpt-5.2',
      scores: {
        global: 80.30,
        reasoning: 92.40,    // GPQA Diamond 92.4%
        coding: 86.00,       // SWE-Bench 80%
        math: 100.00,        // AIME 2025 100%
        data: 82.20,
        language: 82.26,
        security: 82,
        architecture: 85
      }
    },
    
    // GPT-5.1 — Previous gen
    {
      model: 'gpt-5.1',
      provider: 'openai',
      tier: 'standard',
      apiName: 'gpt-5.1',
      scores: {
        global: 75.61,
        reasoning: 80.98,
        coding: 88.78,
        math: 85.58,
        data: 72.75,
        language: 75.48,
        security: 78,
        architecture: 80
      }
    },
    
    // GPT-4.1 — Stable previous gen
    {
      model: 'gpt-4.1',
      provider: 'openai',
      tier: 'standard',
      apiName: 'gpt-4.1',
      scores: {
        global: 74.48,
        reasoning: 81.69,
        coding: 78.11,
        math: 86.17,
        data: 70.04,
        language: 80.69,
        security: 76,
        architecture: 78
      }
    },
    
    // GPT-4.1 Mini — Economy
    {
      model: 'gpt-4.1-mini',
      provider: 'openai',
      tier: 'economy',
      apiName: 'gpt-4.1-mini',
      scores: {
        global: 55.00,
        reasoning: 60.00,
        coding: 65.00,
        math: 70.00,
        data: 55.00,
        language: 65.00,
        security: 60,
        architecture: 62
      }
    },
    
    // GPT-4.1 Nano — Ultra economy
    {
      model: 'gpt-4.1-nano',
      provider: 'openai',
      tier: 'economy',
      apiName: 'gpt-4.1-nano',
      scores: {
        global: 45.00,
        reasoning: 45.00,
        coding: 55.00,
        math: 55.00,
        data: 45.00,
        language: 50.00,
        security: 45,
        architecture: 45
      }
    }
  ]
};

/**
 * Get best model for a specific domain
 */
export function getBestModelForDomain(
  domain: AgentDomain,
  provider?: 'openai' | 'anthropic'
): ModelBenchmark {
  let models = LIVEBENCH_BASELINE.models;
  
  // Filter by provider if specified
  if (provider) {
    models = models.filter(m => m.provider === provider);
  }
  
  // Map domain to score key
  const domainKey = domain === 'architecture' || domain === 'security' 
    ? domain 
    : domain === 'general' 
      ? 'global' 
      : domain;
  
  // Sort by domain score
  const sorted = [...models].sort((a, b) => {
    const scoreA = (a.scores as any)[domainKey] || a.scores.global;
    const scoreB = (b.scores as any)[domainKey] || b.scores.global;
    return scoreB - scoreA;
  });
  
  return sorted[0];
}

/**
 * Get all models sorted by a domain
 */
export function getModelsByDomain(
  domain: AgentDomain,
  provider?: 'openai' | 'anthropic'
): ModelBenchmark[] {
  let models = LIVEBENCH_BASELINE.models;
  
  if (provider) {
    models = models.filter(m => m.provider === provider);
  }
  
  const domainKey = domain === 'architecture' || domain === 'security' 
    ? domain 
    : domain === 'general' 
      ? 'global' 
      : domain;
  
  return [...models].sort((a, b) => {
    const scoreA = (a.scores as any)[domainKey] || a.scores.global;
    const scoreB = (b.scores as any)[domainKey] || b.scores.global;
    return scoreB - scoreA;
  });
}

/**
 * Get flagship models (best overall)
 */
export function getFlagshipModels(): { openai: ModelBenchmark; anthropic: ModelBenchmark } {
  const openai = LIVEBENCH_BASELINE.models
    .filter(m => m.provider === 'openai')
    .sort((a, b) => b.scores.global - a.scores.global)[0];
    
  const anthropic = LIVEBENCH_BASELINE.models
    .filter(m => m.provider === 'anthropic')
    .sort((a, b) => b.scores.global - a.scores.global)[0];
    
  return { openai, anthropic };
}

/**
 * Domain to benchmark category mapping
 */
export const DOMAIN_CATEGORY_MAP: Record<AgentDomain, keyof ModelBenchmark['scores']> = {
  reasoning: 'reasoning',
  coding: 'coding',
  math: 'math',
  data: 'data',
  language: 'language',
  security: 'security',
  architecture: 'architecture',
  general: 'global'
};
