/**
 * M7 v3.0 - Architectural Advisor Rules Registry
 * 
 * Exports all antipattern detection rules.
 */

export { BaseRule } from './base-rule.js';
export { GodObjectRule } from './god-object.js';
export { CircularDepsRule } from './circular-deps.js';
export { DeadCodeRule } from './dead-code.js';

import { KnowledgeGraph } from '../../knowledge-graph/index.js';
import { BaseRule } from './base-rule.js';
import { GodObjectRule } from './god-object.js';
import { CircularDepsRule } from './circular-deps.js';
import { DeadCodeRule } from './dead-code.js';
import { AnalysisThresholds } from '../types.js';

/**
 * Available rule IDs
 */
export const RULE_IDS = [
  'god-object',
  'circular-dependency',
  'dead-code'
] as const;

export type RuleId = typeof RULE_IDS[number];

/**
 * Create all default rules
 */
export function createDefaultRules(
  graph: KnowledgeGraph,
  thresholds?: AnalysisThresholds
): BaseRule[] {
  return [
    new GodObjectRule(graph, thresholds),
    new CircularDepsRule(graph, thresholds),
    new DeadCodeRule(graph, thresholds)
  ];
}

/**
 * Create specific rules by ID
 */
export function createRules(
  graph: KnowledgeGraph,
  ruleIds: RuleId[],
  thresholds?: AnalysisThresholds
): BaseRule[] {
  const ruleFactories: Record<RuleId, () => BaseRule> = {
    'god-object': () => new GodObjectRule(graph, thresholds),
    'circular-dependency': () => new CircularDepsRule(graph, thresholds),
    'dead-code': () => new DeadCodeRule(graph, thresholds)
  };
  
  return ruleIds.map(id => ruleFactories[id]());
}

/**
 * Get rule metadata for all rules
 */
export function getAllRuleMetadata() {
  // Create temporary instances to get metadata
  const tempGraph = { queryNodes: () => [], detectCycles: () => [], findOrphans: () => [] } as any;
  const rules = createDefaultRules(tempGraph);
  return rules.map(r => r.metadata);
}

