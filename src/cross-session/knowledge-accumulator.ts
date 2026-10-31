import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[CrossSession]');
/**
 * M7 v3.0 - Knowledge Accumulator
 * 
 * Stores, retrieves, and manages learned knowledge with confidence tracking.
 * Based on patterns from Emergent Learning Framework (ELF):
 * - EMA smoothing for confidence
 * - Relevance decay (7-day half-life)
 * - High-confidence stability
 * - Golden rule promotion
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';
import { 
  Insight, 
  ProjectGuideline, 
  HeuristicRule, 
  LearningStats, 
  CrossSessionConfig, 
  DEFAULT_CONFIG,
  ProjectContext,
  RelevantKnowledge
} from './types.js';

export class KnowledgeAccumulator {
  private config: CrossSessionConfig;
  private basePath: string;
  
  // In-memory caches
  private insights: Map<string, Insight> = new Map();
  private guidelines: Map<string, ProjectGuideline> = new Map();
  private heuristics: Map<string, HeuristicRule> = new Map();
  private stats: LearningStats;

  constructor(config: Partial<CrossSessionConfig> = {}, projectPath: string = getProjectPath()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.basePath = path.join(projectPath, '.m7', 'cross-session');
    this.stats = this.initStats();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await this.loadFromDisk();
    // Use console.log for informational messages (not errors)
    log.debug(`KnowledgeAccumulator] ✓ Initialized: ${this.insights.size} insights, ${this.heuristics.size} heuristics loaded`);
  }

  // ============================================
  // INSIGHT STORAGE
  // ============================================

  /**
   * Store new insights with duplicate detection and confidence reinforcement
   */
  async storeInsights(insights: Insight[]): Promise<void> {
    for (const insight of insights) {
      const existing = this.findSimilarInsight(insight);
      
      if (existing) {
        // Reinforce existing insight (ELF pattern)
        this.reinforceInsight(existing);
      } else {
        // Store new insight
        this.insights.set(insight.id, insight);
      }
    }

    // Update stats
    this.updateStats();
    
    // Persist to disk
    await this.saveToDisk();
    
    // Check for heuristic promotions
    await this.checkHeuristicPromotions();
  }

  /**
   * Reinforce an existing insight (ELF pattern)
   */
  private reinforceInsight(insight: Insight): void {
    // Update raw confidence
    const oldConfidence = insight.confidence;
    insight.confidence = Math.min(1.0, insight.confidence + 0.1);
    
    // Update EMA confidence (smoothed)
    const alpha = this.calculateAlpha(insight);
    insight.confidenceEma = alpha * insight.confidence + (1 - alpha) * insight.confidenceEma;
    
    // Update usage stats
    insight.usageCount++;
    insight.lastUsedAt = new Date();
    
    // Update validation through repetition
    if (!insight.validation) {
      insight.validation = {
        method: 'repetition',
        result: true,
        timestamp: new Date(),
        count: 1
      };
    } else {
      insight.validation.count++;
      insight.validation.timestamp = new Date();
    }

    log.debug(`KnowledgeAccumulator] ✓ Reinforced insight: ${oldConfidence.toFixed(2)} → ${insight.confidence.toFixed(2)}`);
  }

  /**
   * Calculate adaptive alpha for EMA (ELF pattern)
   * - High confidence = low alpha (stable)
   * - Low confidence = high alpha (can recover faster)
   */
  private calculateAlpha(insight: Insight): number {
    const baseAlpha = this.config.emaAlphaDefault;
    
    // High confidence should be stable
    if (insight.confidence >= this.config.highConfidenceStabilityThreshold) {
      return baseAlpha * 0.5; // Half the learning rate
    }
    
    // Low confidence can recover faster
    if (insight.confidence < 0.4) {
      return Math.min(0.4, baseAlpha * 1.5); // 1.5x learning rate
    }
    
    return baseAlpha;
  }

  // ============================================
  // VALIDATION
  // ============================================

  /**
   * Validate an insight (user feedback or CI result)
   */
  async validateInsight(
    insightId: string, 
    valid: boolean, 
    method: 'user' | 'ci' = 'user'
  ): Promise<void> {
    const insight = this.insights.get(insightId);
    if (!insight) return;

    const oldConfidence = insight.confidence;
    
    if (valid) {
      // Success: increase confidence
      insight.confidence = Math.min(1.0, insight.confidence + 0.1);
      insight.timesValidated++;
    } else {
      // Failure: decrease confidence with stability for high-confidence (ELF pattern)
      const drop = insight.confidence >= this.config.highConfidenceStabilityThreshold
        ? this.config.maxDropPerFailure
        : 0.15;
      
      insight.confidence = Math.max(0.0, insight.confidence - drop);
      insight.timesViolated++;
    }

    // Update EMA
    const alpha = this.calculateAlpha(insight);
    insight.confidenceEma = alpha * insight.confidence + (1 - alpha) * insight.confidenceEma;

    // Update validation record
    if (!insight.validation) {
      insight.validation = {
        method,
        result: valid,
        timestamp: new Date(),
        count: 1
      };
    } else {
      insight.validation.method = method;
      insight.validation.result = valid;
      insight.validation.timestamp = new Date();
      insight.validation.count++;
    }

    log.debug(`KnowledgeAccumulator] ${valid ? '✓' : '✗'} Validated insight: ${oldConfidence.toFixed(2)} → ${insight.confidence.toFixed(2)}`);

    await this.saveToDisk();
  }

  // ============================================
  // RETRIEVAL
  // ============================================

  /**
   * Get relevant knowledge for a query with relevance decay
   */
  async getRelevantKnowledge(query: string, limit: number = 5): Promise<RelevantKnowledge> {
    const now = Date.now();
    const HALF_LIFE = this.config.confidenceDecayHalfLife * 24 * 60 * 60 * 1000;
    
    // Score and filter insights with relevance decay (ELF pattern)
    const scoredInsights = Array.from(this.insights.values())
      .map(insight => {
        const age = now - new Date(insight.lastUsedAt).getTime();
        const decayFactor = Math.pow(this.config.confidenceDecayHalfLife === 7 ? 0.5 : 
          Math.pow(0.5, 1 / this.config.confidenceDecayHalfLife), age / (24 * 60 * 60 * 1000));
        
        // Relevance score = confidence × decay × keyword match
        const keywordMatch = this.calculateKeywordMatch(query, insight.content);
        const score = insight.confidenceEma * decayFactor * (0.5 + 0.5 * keywordMatch);
        
        return { insight, score };
      })
      .filter(({ score }) => score > this.config.minConfidenceThreshold)
      .sort((a, b) => b.score - a.score);

    // Get relevant guidelines
    const relevantGuidelines = Array.from(this.guidelines.values())
      .filter(g => g.confidence > 0.5)
      .filter(g => this.calculateKeywordMatch(query, g.rule) > 0.2)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    // Get active heuristics
    const activeHeuristics = Array.from(this.heuristics.values())
      .filter(h => h.status === 'active' || h.status === 'golden')
      .filter(h => this.calculateKeywordMatch(query, h.pattern) > 0.2)
      .sort((a, b) => b.confidenceEma - a.confidenceEma)
      .slice(0, limit);

    const topInsights = scoredInsights.slice(0, limit);
    const avgScore = topInsights.length > 0 
      ? topInsights.reduce((sum, i) => sum + i.score, 0) / topInsights.length 
      : 0;

    return {
      insights: topInsights.map(i => i.insight),
      guidelines: relevantGuidelines,
      heuristics: activeHeuristics,
      score: avgScore
    };
  }

  /**
   * Get full project context
   */
  async getContext(): Promise<ProjectContext> {
    const now = Date.now();
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

    // Recent insights (last week)
    const recentInsights = Array.from(this.insights.values())
      .filter(i => now - new Date(i.lastUsedAt).getTime() < ONE_WEEK)
      .sort((a, b) => b.confidenceEma - a.confidenceEma)
      .slice(0, 10);

    // Golden rules
    const goldenRules = Array.from(this.heuristics.values())
      .filter(h => h.status === 'golden');

    // Common patterns (high usage + high confidence)
    const patternInsights = Array.from(this.insights.values())
      .filter(i => i.type === 'pattern' && i.usageCount > 2 && i.confidenceEma > 0.6);
    const commonPatterns = patternInsights.map(i => i.content);

    // Known issues (antipatterns with high confidence)
    const antipatterns = Array.from(this.insights.values())
      .filter(i => i.type === 'antipattern' && i.confidenceEma > 0.5);
    const knownIssues = antipatterns.map(i => i.content);

    return {
      guidelines: Array.from(this.guidelines.values()),
      recentInsights,
      goldenRules,
      commonPatterns,
      knownIssues,
      stats: this.getStats()
    };
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    return { ...this.stats };
  }

  // ============================================
  // HEURISTIC PROMOTION (ELF pattern)
  // ============================================

  /**
   * Check and promote high-confidence insights to heuristics
   */
  private async checkHeuristicPromotions(): Promise<void> {
    for (const insight of this.insights.values()) {
      // Check promotion criteria (ELF pattern)
      if (insight.confidenceEma >= this.config.goldenRuleThreshold &&
          insight.timesValidated >= this.config.minValidationsForPromotion &&
          insight.type === 'pattern') {
        
        const heuristicId = `heuristic_${insight.id}`;
        
        if (!this.heuristics.has(heuristicId)) {
          // Promote to golden heuristic
          this.heuristics.set(heuristicId, {
            id: heuristicId,
            domain: insight.category,
            pattern: insight.content,
            action: `Apply learned pattern: ${insight.content}`,
            confidence: insight.confidence,
            confidenceEma: insight.confidenceEma,
            emaAlpha: this.config.emaAlphaDefault,
            emaWarmupRemaining: 0,
            triggers: insight.usageCount,
            successes: insight.timesValidated,
            failures: insight.timesViolated,
            status: 'golden',
            promotedAt: new Date(),
            createdAt: insight.createdAt,
            updatedAt: new Date()
          });
          
          log.debug(`KnowledgeAccumulator] ★ Promoted to GOLDEN: ${insight.content.slice(0, 50)}...`);
        }
      }
    }

    // Update stats
    this.stats.goldenRules = Array.from(this.heuristics.values())
      .filter(h => h.status === 'golden').length;
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Find similar existing insight
   */
  private findSimilarInsight(insight: Insight): Insight | undefined {
    for (const existing of this.insights.values()) {
      if (existing.type === insight.type && 
          existing.category === insight.category &&
          this.calculateSimilarity(existing.content, insight.content) > 0.7) {
        return existing;
      }
    }
    return undefined;
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate keyword match score
   */
  private calculateKeywordMatch(query: string, content: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    
    if (queryWords.size === 0) return 0;
    
    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.has(word)) matches++;
    }
    
    return matches / queryWords.size;
  }

  /**
   * Initialize statistics
   */
  private initStats(): LearningStats {
    return {
      totalSessions: 0,
      totalInsights: 0,
      validatedInsights: 0,
      goldenRules: 0,
      activeHeuristics: 0,
      accuracyTrend: [],
      topPatterns: [],
      improvementAreas: [],
      lastUpdated: new Date()
    };
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.stats.totalInsights = this.insights.size;
    this.stats.validatedInsights = Array.from(this.insights.values())
      .filter(i => i.validation?.result).length;
    this.stats.goldenRules = Array.from(this.heuristics.values())
      .filter(h => h.status === 'golden').length;
    this.stats.activeHeuristics = Array.from(this.heuristics.values())
      .filter(h => h.status === 'active' || h.status === 'golden').length;
    
    // Calculate top patterns
    const patterns = Array.from(this.insights.values())
      .filter(i => i.type === 'pattern')
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);
    
    this.stats.topPatterns = patterns.map(p => ({
      pattern: p.content.slice(0, 50),
      count: p.usageCount,
      successRate: p.timesValidated / Math.max(p.timesValidated + p.timesViolated, 1)
    }));
    
    // Calculate improvement areas
    const antipatterns = Array.from(this.insights.values())
      .filter(i => i.type === 'antipattern' && i.confidenceEma > 0.6)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);
    
    this.stats.improvementAreas = antipatterns.map(a => a.content.slice(0, 50));
    this.stats.lastUpdated = new Date();
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  /**
   * Load data from disk
   */
  private async loadFromDisk(): Promise<void> {
    try {
      // Load insights
      const insightsPath = path.join(this.basePath, 'insights.json');
      try {
        const data = await fs.readFile(insightsPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const i of parsed) {
            // Convert date strings to Date objects
            i.createdAt = new Date(i.createdAt);
            i.lastUsedAt = new Date(i.lastUsedAt);
            if (i.validation?.timestamp) {
              i.validation.timestamp = new Date(i.validation.timestamp);
            }
            this.insights.set(i.id, i);
          }
        }
      } catch (err) {
        // File may not exist on first run - this is expected
        const isFileNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        if (!isFileNotFound) {
          log.warn('KnowledgeAccumulator] Could not load insights:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      // Load guidelines
      const guidelinesPath = path.join(this.basePath, 'guidelines.json');
      try {
        const data = await fs.readFile(guidelinesPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const g of parsed) {
            g.createdAt = new Date(g.createdAt);
            g.lastValidated = new Date(g.lastValidated);
            this.guidelines.set(g.id, g);
          }
        }
      } catch (err) {
        const isFileNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        if (!isFileNotFound) {
          log.warn('KnowledgeAccumulator] Could not load guidelines:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      // Load heuristics
      const heuristicsPath = path.join(this.basePath, 'heuristics.json');
      try {
        const data = await fs.readFile(heuristicsPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const h of parsed) {
            h.createdAt = new Date(h.createdAt);
            h.updatedAt = new Date(h.updatedAt);
            if (h.promotedAt) h.promotedAt = new Date(h.promotedAt);
            this.heuristics.set(h.id, h);
          }
        }
      } catch (err) {
        const isFileNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        if (!isFileNotFound) {
          log.warn('KnowledgeAccumulator] Could not load heuristics:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      // Load stats
      const statsPath = path.join(this.basePath, 'stats.json');
      try {
        const data = await fs.readFile(statsPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.stats = { 
          ...this.stats, 
          ...parsed,
          lastUpdated: new Date(parsed.lastUpdated)
        };
      } catch (err) {
        const isFileNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        if (!isFileNotFound) {
          log.warn('KnowledgeAccumulator] Could not load stats:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

    } catch (error) {
      log.warn('KnowledgeAccumulator] Error loading from disk:', error);
    }
  }

  /**
   * Save data to disk
   */
  private async saveToDisk(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });

      // Save insights
      await fs.writeFile(
        path.join(this.basePath, 'insights.json'),
        JSON.stringify(Array.from(this.insights.values()), null, 2)
      );

      // Save guidelines
      await fs.writeFile(
        path.join(this.basePath, 'guidelines.json'),
        JSON.stringify(Array.from(this.guidelines.values()), null, 2)
      );

      // Save heuristics
      await fs.writeFile(
        path.join(this.basePath, 'heuristics.json'),
        JSON.stringify(Array.from(this.heuristics.values()), null, 2)
      );

      // Save stats
      await fs.writeFile(
        path.join(this.basePath, 'stats.json'),
        JSON.stringify(this.stats, null, 2)
      );

    } catch (error) {
      log.warn('KnowledgeAccumulator] Error saving to disk:', error);
    }
  }

  /**
   * Cleanup old/low-confidence data
   */
  async cleanup(options: { 
    olderThanDays?: number; 
    belowConfidence?: number;
  } = {}): Promise<number> {
    const { 
      olderThanDays = 90, 
      belowConfidence = 0.2 
    } = options;
    
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, insight] of this.insights) {
      const age = new Date(insight.lastUsedAt).getTime();
      
      if (age < cutoff || insight.confidenceEma < belowConfidence) {
        this.insights.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.updateStats();
      await this.saveToDisk();
    }

    return removed;
  }
}

