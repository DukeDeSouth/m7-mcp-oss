/**
 * M7 Hive v2.0 - Dynamic Intelligence Module
 * 
 * Exports all components for dynamic agent generation and model selection.
 * 
 * @version 3.7.0
 */

// Types
export * from './types.js';

// Benchmark Data
export { 
  LIVEBENCH_BASELINE, 
  getBestModelForDomain, 
  getModelsByDomain,
  getFlagshipModels,
  DOMAIN_CATEGORY_MAP 
} from './benchmarkData.js';

// Hive Architect
export { HiveArchitect, createHiveArchitect } from './hiveArchitect.js';

// Model Selector
export { ModelSelector, createModelSelector, selectModel } from './modelSelector.js';

// Self-Learning
export {
  logExecution,
  readExecutionLogs,
  recalculateAdjustments,
  getLearningAdjustments,
  getLearningState,
  addUserRating,
  clearLearningData,
  getLearningStats
} from './selfLearning.js';
