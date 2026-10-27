import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[ArchAdvisor]');
/**
 * M7 v3.0 - Architectural Advisor
 * 
 * Architecture analysis, antipattern detection, C4 diagrams,
 * and refactoring suggestions.
 */

// ============================================
// EXPORTS
// ============================================

export * from './types.js';
export { C4Generator } from './c4-generator.js';
export { ArchitectureScorer } from './architecture-scorer.js';
export { 
  BaseRule, 
  GodObjectRule, 
  CircularDepsRule, 
  DeadCodeRule,
  createDefaultRules,
  createRules,
  getAllRuleMetadata,
  RULE_IDS
} from './rules/index.js';

// ============================================
// IMPORTS
// ============================================

import { KnowledgeGraph, getKnowledgeGraph } from '../knowledge-graph/index.js';
import { C4Generator } from './c4-generator.js';
import { ArchitectureScorer, ScoringMetrics } from './architecture-scorer.js';
import { createDefaultRules, createRules, BaseRule, RuleId } from './rules/index.js';
import {
  AnalysisOptions,
  ArchitectureScore,
  C4Diagram,
  C4Level,
  C4Options,
  DetectedAntipattern,
  RefactoringSuggestion,
  AnalysisThresholds,
  DEFAULT_THRESHOLDS
} from './types.js';

// ============================================
// MAIN CLASS
// ============================================

/**
 * Architectural Advisor
 * 
 * Main API for architecture analysis:
 * - Antipattern detection
 * - C4 diagram generation
 * - Refactoring suggestions
 * - Architecture scoring
 */
export class ArchitecturalAdvisor {
  private graph: KnowledgeGraph;
  private c4Generator: C4Generator;
  private scorer: ArchitectureScorer;
  private rules: BaseRule[];
  private projectPath: string;
  private thresholds: Required<AnalysisThresholds>;
  
  constructor(projectPath: string, graph?: KnowledgeGraph, thresholds?: AnalysisThresholds) {
    this.projectPath = projectPath;
    this.graph = graph ?? getKnowledgeGraph();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.c4Generator = new C4Generator(this.graph, projectPath);
    this.scorer = new ArchitectureScorer();
    this.rules = createDefaultRules(this.graph, this.thresholds);
  }
  
  // ============================================
  // ANALYSIS
  // ============================================
  
  /**
   * Run full architecture analysis
   */
  async analyze(options?: AnalysisOptions): Promise<ArchitectureScore> {
    // Ensure graph is built
    await this.ensureGraphReady();
    
    // Report progress
    options?.onProgress?.({
      phase: 'analyzing',
      current: 0,
      total: this.rules.length,
      message: 'Detecting antipatterns...'
    });
    
    // Detect all antipatterns
    const antipatterns = this.detectAntipatterns(options);
    
    options?.onProgress?.({
      phase: 'generating',
      current: 1,
      total: 2,
      message: 'Generating suggestions...'
    });
    
    // Generate suggestions
    const suggestions = this.generateSuggestions(antipatterns);
    
    options?.onProgress?.({
      phase: 'scoring',
      current: 2,
      total: 2,
      message: 'Calculating score...'
    });
    
    // Get metrics from graph
    const graphMetrics = this.graph.getMetrics();
    const metrics: ScoringMetrics = {
      coupling: this.normalizeCoupling(graphMetrics.avgDegree),
      cohesion: this.calculateCohesion({
        orphanCount: graphMetrics.orphans,
        nodeCount: graphMetrics.totalNodes
      }),
      complexity: graphMetrics.avgDegree
    };
    
    // Calculate score
    return this.scorer.calculate(antipatterns, suggestions, metrics);
  }
  
  /**
   * Detect antipatterns only
   */
  detectAntipatterns(options?: AnalysisOptions): DetectedAntipattern[] {
    const antipatterns: DetectedAntipattern[] = [];
    
    // Get active rules
    const activeRules = this.getActiveRules(options);
    
    // Run each rule
    for (const rule of activeRules) {
      try {
        const detected = rule.detect();
        antipatterns.push(...detected);
      } catch (error) {
        log.debug(`ArchAdvisor] Error in rule ${rule.id}:`, error);
      }
    }
    
    // Sort by severity
    return antipatterns.sort((a, b) => {
      const severityOrder = { critical: 0, major: 1, minor: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }
  
  /**
   * Generate refactoring suggestions
   */
  generateSuggestions(antipatterns: DetectedAntipattern[]): RefactoringSuggestion[] {
    const suggestions: RefactoringSuggestion[] = [];
    
    // Find the rule for each antipattern and generate suggestion
    for (const antipattern of antipatterns) {
      const rule = this.rules.find(r => antipattern.id.startsWith(r.id));
      if (rule) {
        try {
          suggestions.push(rule.suggest(antipattern));
        } catch (error) {
          log.debug(`ArchAdvisor] Error generating suggestion for ${antipattern.id}:`, error);
        }
      }
    }
    
    // Prioritize by impact/effort ratio
    return this.prioritizeSuggestions(suggestions);
  }
  
  // ============================================
  // C4 DIAGRAMS
  // ============================================
  
  /**
   * Generate C4 diagram at specified level
   */
  generateC4Diagram(level: C4Level, options?: C4Options): C4Diagram {
    return this.c4Generator.generate(level, options);
  }
  
  /**
   * Generate all C4 diagrams
   */
  generateAllDiagrams(options?: C4Options): C4Diagram[] {
    return this.c4Generator.generateAll(options);
  }
  
  // ============================================
  // QUICK METHODS
  // ============================================
  
  /**
   * Get architecture score only (quick summary)
   */
  async getScore(): Promise<ArchitectureScore> {
    return this.analyze();
  }
  
  /**
   * Get critical issues only
   */
  getCriticalIssues(): DetectedAntipattern[] {
    return this.detectAntipatterns().filter(a => a.severity === 'critical');
  }
  
  /**
   * Get top suggestions (most impactful, least effort)
   */
  getTopSuggestions(limit: number = 5): RefactoringSuggestion[] {
    const antipatterns = this.detectAntipatterns();
    const suggestions = this.generateSuggestions(antipatterns);
    return suggestions.slice(0, limit);
  }
  
  // ============================================
  // CONFIGURATION
  // ============================================
  
  /**
   * Update thresholds
   */
  setThresholds(thresholds: Partial<AnalysisThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    // Recreate rules with new thresholds
    this.rules = createDefaultRules(this.graph, this.thresholds);
  }
  
  /**
   * Set specific rules to use
   */
  setRules(ruleIds: RuleId[]): void {
    this.rules = createRules(this.graph, ruleIds, this.thresholds);
  }
  
  /**
   * Add custom rule
   */
  addRule(rule: BaseRule): void {
    this.rules.push(rule);
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  /**
   * Ensure Knowledge Graph is ready
   */
  private async ensureGraphReady(): Promise<void> {
    if (!this.graph.built) {
      log.debug('ArchAdvisor] Building Knowledge Graph...');
      await this.graph.build({ rootPath: this.projectPath });
      log.debug(`ArchAdvisor] Graph built: ${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges`);
    }
  }
  
  /**
   * Get active rules based on options
   */
  private getActiveRules(options?: AnalysisOptions): BaseRule[] {
    if (!options) return this.rules;
    
    let rules = this.rules;
    
    // Filter by enabled rules
    if (options.enabledRules && options.enabledRules.length > 0) {
      rules = rules.filter(r => options.enabledRules!.includes(r.id));
    }
    
    // Filter by disabled rules
    if (options.disabledRules && options.disabledRules.length > 0) {
      rules = rules.filter(r => !options.disabledRules!.includes(r.id));
    }
    
    return rules;
  }
  
  /**
   * Prioritize suggestions by impact/effort ratio
   */
  private prioritizeSuggestions(suggestions: RefactoringSuggestion[]): RefactoringSuggestion[] {
    const effortScore = { low: 1, medium: 2, high: 3 };
    const impactScore = { low: 1, medium: 2, high: 3 };
    
    return suggestions.sort((a, b) => {
      // High impact + low effort = highest priority
      const scoreA = impactScore[a.impact] / effortScore[a.effort];
      const scoreB = impactScore[b.impact] / effortScore[b.effort];
      return scoreB - scoreA;
    });
  }
  
  /**
   * Normalize coupling to 0-1 range
   */
  private normalizeCoupling(avgDependencies: number): number {
    // Assume 10 dependencies is "fully coupled"
    return Math.min(1, avgDependencies / 10);
  }
  
  /**
   * Calculate cohesion metric
   */
  private calculateCohesion(metrics: { orphanCount: number; nodeCount: number }): number {
    if (metrics.nodeCount === 0) return 1;
    // Higher orphan ratio = lower cohesion
    const orphanRatio = metrics.orphanCount / metrics.nodeCount;
    return Math.max(0, 1 - orphanRatio);
  }
}

// ============================================
// SINGLETON
// ============================================

let advisorInstance: ArchitecturalAdvisor | null = null;
let advisorProjectPath: string | null = null;

/**
 * Get or create Architectural Advisor instance
 */
export function getArchitecturalAdvisor(projectPath: string): ArchitecturalAdvisor {
  if (!advisorInstance || advisorProjectPath !== projectPath) {
    advisorInstance = new ArchitecturalAdvisor(projectPath);
    advisorProjectPath = projectPath;
  }
  return advisorInstance;
}

/**
 * Create new Architectural Advisor instance
 */
export function createArchitecturalAdvisor(
  projectPath: string, 
  graph?: KnowledgeGraph,
  thresholds?: AnalysisThresholds
): ArchitecturalAdvisor {
  return new ArchitecturalAdvisor(projectPath, graph, thresholds);
}

export default ArchitecturalAdvisor;

