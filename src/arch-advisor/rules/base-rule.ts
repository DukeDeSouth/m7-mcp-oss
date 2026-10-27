/**
 * M7 v3.0 - Architectural Advisor Base Rule
 * 
 * Abstract base class for antipattern detection rules.
 */

import { KnowledgeGraph } from '../../knowledge-graph/index.js';
import {
  DetectedAntipattern,
  RefactoringSuggestion,
  AntipatternSeverity,
  AntipatternCategory,
  AntipatternTarget,
  RefactoringType,
  RuleMetadata,
  IRule,
  AnalysisThresholds,
  DEFAULT_THRESHOLDS
} from '../types.js';

/**
 * Abstract base class for antipattern detection rules
 */
export abstract class BaseRule implements IRule {
  protected graph: KnowledgeGraph;
  protected thresholds: Required<AnalysisThresholds>;
  
  constructor(graph: KnowledgeGraph, thresholds?: AnalysisThresholds) {
    this.graph = graph;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }
  
  // ============================================
  // ABSTRACT PROPERTIES (must implement)
  // ============================================
  
  /** Unique rule identifier */
  abstract get id(): string;
  
  /** Human-readable name */
  abstract get name(): string;
  
  /** Antipattern category */
  abstract get category(): AntipatternCategory;
  
  /** Default severity level */
  abstract get defaultSeverity(): AntipatternSeverity;
  
  /** Rule description */
  abstract get description(): string;
  
  // ============================================
  // ABSTRACT METHODS (must implement)
  // ============================================
  
  /**
   * Detect antipatterns in the codebase
   */
  abstract detect(): DetectedAntipattern[];
  
  /**
   * Generate refactoring suggestion for an antipattern
   */
  abstract suggest(antipattern: DetectedAntipattern): RefactoringSuggestion;
  
  // ============================================
  // METADATA
  // ============================================
  
  /**
   * Get rule metadata
   */
  get metadata(): RuleMetadata {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      defaultSeverity: this.defaultSeverity,
      description: this.description,
      enabledByDefault: true
    };
  }
  
  // ============================================
  // HELPER METHODS
  // ============================================
  
  /**
   * Create an antipattern detection result
   */
  protected createAntipattern(params: {
    target: AntipatternTarget;
    description: string;
    evidence: string[];
    metrics?: Record<string, number>;
    confidence: number;
    severityOverride?: AntipatternSeverity;
  }): DetectedAntipattern {
    return {
      id: `${this.id}_${params.target.nodeId}`,
      name: this.name,
      category: this.category,
      severity: params.severityOverride ?? this.defaultSeverity,
      target: params.target,
      description: params.description,
      evidence: params.evidence,
      metrics: params.metrics,
      confidence: Math.min(1, Math.max(0, params.confidence))
    };
  }
  
  /**
   * Create a refactoring suggestion
   */
  protected createSuggestion(params: {
    antipattern: DetectedAntipattern;
    type: RefactoringType;
    title: string;
    description: string;
    steps: string[];
    effort: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    beforeCode?: string;
    afterCode?: string;
  }): RefactoringSuggestion {
    return {
      id: `suggestion_${params.antipattern.id}`,
      antipatternId: params.antipattern.id,
      type: params.type,
      priority: params.antipattern.severity,
      target: params.antipattern.target,
      title: params.title,
      description: params.description,
      steps: params.steps,
      effort: params.effort,
      impact: params.impact,
      confidence: params.antipattern.confidence,
      beforeCode: params.beforeCode,
      afterCode: params.afterCode
    };
  }
  
  /**
   * Calculate confidence based on how much a value exceeds a threshold
   */
  protected calculateConfidence(value: number, threshold: number, maxMultiplier: number = 2): number {
    if (value <= threshold) return 0;
    const ratio = value / threshold;
    return Math.min(1, (ratio - 1) / (maxMultiplier - 1));
  }
  
  /**
   * Filter antipatterns by minimum confidence
   */
  protected filterByConfidence(antipatterns: DetectedAntipattern[]): DetectedAntipattern[] {
    return antipatterns.filter(a => a.confidence >= this.thresholds.minConfidence);
  }
}

