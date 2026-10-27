// Main Hive exports
export { HiveOrchestrator } from './orchestrator/hiveOrchestrator.js';
export { DynamicHiveOrchestrator, createDynamicOrchestrator } from './orchestrator/dynamicOrchestrator.js';
export { PlannerOrchestrator, createPlannerOrchestrator } from './orchestrator/plannerOrchestrator.js';
export { APIManager } from './api/apiManager.js';
export { hiveCoordinatorTool } from './tools/hiveCoordinator.js';
export { hiveHistoryTool } from './tools/hiveHistory.js';

// v3.8.0 Planner exports
export {
  PlannerAgent,
  createPlannerAgent,
  AuctioneerSupervisor,
  createAuctioneerSupervisor,
  GatekeeperManager,
  createGatekeeperManager
} from './planner/index.js';

// v3.7.0 Dynamic Intelligence exports
export {
  HiveArchitect,
  createHiveArchitect,
  ModelSelector,
  createModelSelector,
  selectModel,
  LIVEBENCH_BASELINE,
  getBestModelForDomain,
  getModelsByDomain,
  getFlagshipModels,
  logExecution,
  getLearningStats,
  getLearningAdjustments,
  addUserRating
} from './intelligence/index.js';

// Agent exports
export { BaseAgent } from './agents/baseAgent.js';
export { ResearchAgent } from './agents/researchAgent.js';
export { ImplementationAgent } from './agents/implementationAgent.js';

// Type exports
export type { 
  AgentType, 
  AgentConfig, 
  AgentProposal, 
  AgentContext,
  AgentResponse 
} from './types/agent.js';

export type { 
  HiveTask, 
  HiveResult,
  HiveMode
} from './types/task.js';

export type { 
  APIConfig, 
  APIResponse, 
  RequestMetrics 
} from './types/api.js';

// v3.7.0 Dynamic Intelligence types
export type {
  DynamicAgent,
  DynamicAgentProposal,
  DynamicHiveResult,
  ArchitectResponse,
  ModelSelection,
  ModelBenchmark,
  ModelScores,
  AgentDomain,
  ExecutionLog,
  LearningAdjustment,
  LearningState
} from './intelligence/types.js';

// v3.8.0 Planner types
export type {
  CNPTask,
  CNPTaskState,
  CNPBid,
  CNPAward,
  CNPResult,
  CNPValidation,
  CNPScoreBreakdown,
  CNPScoringWeights,
  CNPConstraints,
  BiddableAgent,
  AgentCapability,
  GatekeeperConfig,
  PlannerOptions,
  PlannerResult
} from './planner/types.js';
