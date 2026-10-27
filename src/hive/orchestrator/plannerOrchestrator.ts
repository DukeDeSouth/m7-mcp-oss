/**
 * M7 Hive v3.0 - Planner Orchestrator
 * 
 * Main orchestrator for CNP-based task execution with Planner/Supervisor.
 * Coordinates goal decomposition, auctions, execution, and validation.
 * 
 * @version 3.8.0
 */

import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { HiveTask } from '../types/task.js';
import { APIConfig } from '../types/api.js';
import { JournalSystem } from '../../journal/journalSystem.js';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { createLogger } from '../../core/utils/logger.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';

const log = createLogger('[PlannerOrchestrator]');
import { initializeClientPool, getOpenAI, getAnthropic, getClientPool } from '../api/clientPool.js';

// Planner imports
import {
  CNPTask,
  CNPBid,
  CNPResult,
  PlannerResult,
  PlannerOptions,
  BiddableAgent,
  DEFAULT_PLANNER_OPTIONS
} from '../planner/types.js';
import { PlannerAgent } from '../planner/plannerAgent.js';
import { AuctioneerSupervisor } from '../planner/auctioneerSupervisor.js';
import { GatekeeperManager } from '../planner/gatekeepers.js';

// Intelligence imports for agent generation
import { HiveArchitect, ModelSelector, DynamicAgent, ModelSelection, ArchitectResponse } from '../intelligence/index.js';

// Code context injection
import { CodeContextInjector, CodeContext } from '../context/index.js';

// Agent memory for session learning
import { getAgentMemory, AgentMemory } from '../memory/index.js';

// Task result caching
import { getTaskResultCache, TaskResultCache } from '../cache/index.js';

// Cross-Session Learning
import { getCrossSessionLearning, CrossSessionLearning, RelevantKnowledge } from '../../cross-session/index.js';

// Streaming execution
import { executeWithSmartStreaming, StreamingResult } from '../streaming/index.js';

/**
 * Planner Orchestrator
 * 
 * Executes tasks using CNP auction-based coordination.
 */
export class PlannerOrchestrator {
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;
  private planner: PlannerAgent;
  private auctioneer: AuctioneerSupervisor;
  private gatekeepers: GatekeeperManager;
  private architect: HiveArchitect;
  private modelSelector: ModelSelector;
  private contextInjector: CodeContextInjector;
  private memoryCore: UnifiedMemoryCore | null = null;
  private journal: JournalSystem;
  private options: PlannerOptions;
  
  // Cache for batch-prefetched teams
  private teamCache: Map<string, ArchitectResponse> = new Map();
  
  // Agent memory for session learning
  private agentMemory: AgentMemory;
  
  // Task result cache
  private taskCache: TaskResultCache;
  
  // Cross-Session Learning
  private crossSessionLearning: CrossSessionLearning;
  
  constructor(
    config: APIConfig,
    journal: JournalSystem,
    options: Partial<PlannerOptions> = {}
  ) {
    this.options = { ...DEFAULT_PLANNER_OPTIONS, ...options };
    
    // Initialize ClientPool singleton (first call initializes, subsequent calls update)
    initializeClientPool({
      openaiKey: config.openai,
      anthropicKey: config.anthropic
    });
    
    // Get pooled clients
    this.openaiClient = getOpenAI('default');
    this.anthropicClient = getAnthropic('default');
    
    // Sub-components will use ClientPool automatically
    this.planner = new PlannerAgent();  // Uses pooled client
    this.auctioneer = new AuctioneerSupervisor(this.options);
    this.gatekeepers = new GatekeeperManager(this.options.gatekeepers);
    this.architect = new HiveArchitect();  // Uses pooled client
    this.modelSelector = new ModelSelector();
    this.contextInjector = new CodeContextInjector(getProjectPath());
    this.agentMemory = getAgentMemory();  // Session-level memory
    this.taskCache = getTaskResultCache();  // Result caching
    this.crossSessionLearning = getCrossSessionLearning();  // Cross-Session Learning
    this.journal = journal;
    
    const poolStats = getClientPool().getStats();
    log.info(`[Planner Orchestrator] ✅ Initialized with ClientPool + AgentMemory + TaskCache`);
  }
  
  /**
   * Execute task with CNP coordination
   */
  async coordinateTask(task: HiveTask): Promise<PlannerResult> {
    const startTime = Date.now();
    const goalId = task.id || `goal_${randomUUID()}`;
    
    log.debug(`Planner] 🚀 coordinateTask ENTER: ${task.description.substring(0, 50)}...`);
    log.info(`[Planner] 🚀 Starting planned coordination for: ${task.description.substring(0, 80)}...`);
    
    // v3.9: Get cross-session knowledge for decomposition
    let crossSessionPrompt = '';
    try {
      await this.crossSessionLearning.initialize();
      const knowledge = await this.crossSessionLearning.getRelevantKnowledge(task.description, 5);
      
      if (knowledge.insights.length > 0 || knowledge.heuristics.length > 0) {
        crossSessionPrompt = await this.crossSessionLearning.formatContextForPrompt(task.description);
        log.debug(`✓ Cross-Session: ${knowledge.insights.length} insights, ${knowledge.heuristics.length} heuristics loaded`);
        
        // Inject into task context for decomposition
        if (!task.context) task.context = {};
        task.context.cross_session_knowledge = knowledge;
      }
    } catch (e: any) {
      log.debug(`Planner v3.9] Cross-Session knowledge skipped: ${e.message}`);
    }
    
    try {
      // Phase 1: Decompose goal into subtasks
      const planStart = Date.now();
      log.debug(`Planner] 📋 Phase 1: Starting decomposition...`);
      
      const { tasks, reasoning } = await this.planner.decompose(
        task.description,
        task.context,
        { maxTimeMs: task.plannerOptions?.auctionTimeoutMs }
      );
      const planLatency = Date.now() - planStart;
      
      log.debug(`Planner] 📋 Decomposed into ${tasks.length} tasks in ${planLatency}ms: ${reasoning}`);
      log.debug(`Planner] 📋 Task types: ${tasks.map(t => `${t.type}:${t.description.substring(0,30)}`).join(', ')}`);
      log.info(`[Planner] 📋 Decomposed into ${tasks.length} tasks: ${reasoning}`);
      
      // Phase 2: Get execution order
      const executionWaves = this.planner.getExecutionOrder(tasks);
      log.info(`[Planner] 🌊 Execution in ${executionWaves.length} waves`);
      
      // Phase 3: Execute waves
      const allAwards: PlannerResult['awards'] = [];
      const allResults: PlannerResult['results'] = [];
      const allValidations: PlannerResult['validations'] = [];
      
      let auctionLatency = 0;
      let executionLatency = 0;
      let validationLatency = 0;
      
      for (let waveIdx = 0; waveIdx < executionWaves.length; waveIdx++) {
        const wave = executionWaves[waveIdx];
        log.info(`[Planner] 🌊 Wave ${waveIdx + 1}/${executionWaves.length}: ${wave.length} tasks`);
        
        // Batch prefetch teams for all tasks in this wave
        const executableTasks = wave.filter(t => t.type !== 'goal');
        if (executableTasks.length > 1) {
          try {
            const batchStart = Date.now();
            const taskDescs = executableTasks.map(t => t.description);
            const batchTeams = await this.architect.createTeamBatch(taskDescs);
            
            // Store in cache
            for (const [desc, team] of batchTeams) {
              this.teamCache.set(desc, team);
            }
            
            log.debug(`Planner] 🚀 Batch prefetched ${batchTeams.size} teams in ${Date.now() - batchStart}ms`);
          } catch (e: any) {
            log.debug(`Planner] Batch prefetch failed, will use individual calls: ${e.message}`);
          }
        }
        
        // Execute tasks in wave (parallel or sequential based on config)
        const wavePromises = wave.map(async (cnpTask) => {
          // Skip goal task (it's just a container)
          if (cnpTask.type === 'goal') return null;
          
          try {
            // Create agent team for this task
            const auctionStart = Date.now();
            const { award, agents } = await this.runAuctionForTask(cnpTask);
            auctionLatency += Date.now() - auctionStart;
            
            allAwards.push(award);
            
            // Execute winning agent
            const execStart = Date.now();
            const result = await this.executeTask(cnpTask, award, agents);
            executionLatency += Date.now() - execStart;
            
            allResults.push(result);
            
            // Validate result
            const valStart = Date.now();
            const validations = await this.gatekeepers.validate(result);
            validationLatency += Date.now() - valStart;
            
            allValidations.push(...validations);
            
            // Update task state
            const passed = this.gatekeepers.allPassed(validations);
            cnpTask.state = passed ? 'ACCEPTED' : 'REJECTED';
            
            // Record for learning
            this.auctioneer.recordExecution(
              award.winnerId,
              award.winningBid.estimatedCost,
              result.actualCost,
              passed
            );
            
            return { cnpTask, award, result, validations, passed };
          } catch (taskError: any) {
            log.debug(`Planner] ⚠️ Task failed: ${cnpTask.description.substring(0, 40)}... - ${taskError.message}`);
            cnpTask.state = 'CANCELLED';
            // Return null to continue with other tasks
            return null;
          }
        });
        
        if (this.options.parallelAuctions) {
          await Promise.all(wavePromises);
        } else {
          for (const promise of wavePromises) {
            await promise;
          }
        }
      }
      
      // Phase 4: Synthesize results
      const synthesisContent = this.synthesizeResults(allResults, tasks);
      
      // Phase 5: Store and log
      await this.storeResults(goalId, task, allResults);
      
      const totalLatency = Date.now() - startTime;
      
      const result: PlannerResult = {
        success: true,
        goalId,
        goal: task.description,
        tasks,
        awards: allAwards,
        results: allResults,
        validations: allValidations,
        synthesis: {
          content: synthesisContent,
          confidence: this.calculateOverallConfidence(allResults, allValidations),
          contributingTasks: allResults.filter(r => r.success).map(r => r.taskId)
        },
        metrics: {
          totalTokens: allResults.reduce((sum, r) => sum + r.actualCost, 0),
          totalCost: this.estimateCost(allResults),
          totalLatencyMs: totalLatency,
          planningLatencyMs: planLatency,
          auctionLatencyMs: auctionLatency,
          executionLatencyMs: executionLatency,
          validationLatencyMs: validationLatency
        }
      };
      
      log.info(`[Planner] 🎯 Completed in ${totalLatency}ms, ${allResults.length} tasks executed`);
      
      return result;
      
    } catch (error: any) {
      log.debug(`Planner] ❌ Coordination CATCH: ${error.message}`);
      log.debug(`Planner] ❌ Error stack: ${error.stack}`);
      log.error(`[Planner] ❌ Coordination failed: ${error.message}`);
      
      return {
        success: false,
        goalId,
        goal: task.description,
        tasks: [],
        awards: [],
        results: [],
        validations: [],
        synthesis: {
          content: '',
          confidence: 0,
          contributingTasks: []
        },
        metrics: {
          totalTokens: 0,
          totalCost: 0,
          totalLatencyMs: Date.now() - startTime,
          planningLatencyMs: 0,
          auctionLatencyMs: 0,
          executionLatencyMs: 0,
          validationLatencyMs: 0
        },
        error: error.message
      };
    }
  }
  
  /**
   * Run auction for a single task
   */
  private async runAuctionForTask(
    task: CNPTask
  ): Promise<{ award: PlannerResult['awards'][0]; agents: BiddableAgent[] }> {
    
    log.debug(`Planner] 🏆 Running auction for: ${task.description.substring(0, 40)}...`);
    
    // Check cache first (from batch prefetch)
    let teamConfig: ArchitectResponse | undefined = this.teamCache.get(task.description);
    if (teamConfig) {
      log.debug(`Planner] 📦 Using cached team (batch prefetched)`);
      this.teamCache.delete(task.description); // Clean up after use
    } else {
      // Fallback to individual API call
      teamConfig = await this.architect.createTeam(task.description);
    }
    
    if (!teamConfig) {
      throw new Error('Failed to get team configuration');
    }
    
    log.debug(`Planner] 👥 Architect returned ${teamConfig.agents.length} agents: ${teamConfig.agents.map(a => a.role).join(', ')}`);
    
    const modelSelections = this.modelSelector.selectModelsForTeam(teamConfig.agents);
    
    // Convert DynamicAgents to BiddableAgents
    const biddableAgents: BiddableAgent[] = teamConfig.agents.map(agent => ({
      id: agent.id,
      role: agent.role,
      capabilities: [{
        domain: agent.domain,
        skills: [agent.expertise],
        costMultiplier: 1.0,
        speedMultiplier: 1.0
      }],
      currentLoad: 0,
      winRate: 0.5,
      trustScore: 0.7
    }));
    
    // Create bid generator
    const getBid = async (agent: BiddableAgent, cnpTask: CNPTask): Promise<CNPBid | null> => {
      const dynamicAgent = teamConfig.agents.find(a => a.id === agent.id);
      if (!dynamicAgent) return null;
      
      const modelSelection = modelSelections.get(agent.id);
      if (!modelSelection) return null;
      
      // Generate bid based on agent capabilities
      return {
        id: `bid_${randomUUID()}`,
        taskId: cnpTask.id,
        agentId: agent.id,
        agentRole: agent.role,
        estimatedCost: this.estimateTokens(cnpTask, dynamicAgent),
        estimatedTime: this.estimateTime(cnpTask, dynamicAgent),
        confidence: this.estimateConfidence(cnpTask, dynamicAgent),
        approach: `Using ${dynamicAgent.expertise} to ${cnpTask.description.substring(0, 50)}...`,
        risks: [],
        submittedAt: new Date().toISOString()
      };
    };
    
    // Run auction
    const award = await this.auctioneer.runAuction(task, biddableAgents, getBid);
    
    return { award, agents: biddableAgents };
  }
  
  /**
   * Execute task with winning agent
   */
  private async executeTask(
    task: CNPTask,
    award: PlannerResult['awards'][0],
    agents: BiddableAgent[]
  ): Promise<CNPResult> {
    
    const startTime = Date.now();
    const agent = agents.find(a => a.id === award.winnerId);
    
    // Check cache for similar task result
    const cachedResult = this.taskCache.get(task.description, award.winnerRole);
    if (cachedResult) {
      log.debug(`Planner] ⚡ Using cached result (saved ${cachedResult.tokensUsed} tokens)`);
      return {
        taskId: task.id,
        agentId: award.winnerId,
        success: true,
        output: cachedResult.result,
        actualCost: 0,  // No API cost - cached
        actualTime: Date.now() - startTime,
        artifacts: [],
        submittedAt: new Date().toISOString(),
        cached: true
      };
    }
    
    // Get code context for the task
    let codeContextMarkdown = '';
    try {
      const codeContext = await this.contextInjector.getContext(task.description);
      if (codeContext.files.length > 0) {
        codeContextMarkdown = '\n\n' + codeContext.markdown;
        log.debug(`Planner] 📁 Injected ${codeContext.files.length} files, ${codeContext.totalTokens} tokens`);
      }
    } catch (e: any) {
      log.debug(`Planner] Code context error: ${e.message}`);
    }
    
    // Get agent memory injection
    const memoryInjection = this.agentMemory.getPromptInjection(award.winnerRole);
    if (memoryInjection) {
      log.debug(`Planner] 🧠 Injecting session memory for ${award.winnerRole}`);
    }
    
    // v3.9: Get cross-session knowledge injection
    let crossSessionInjection = '';
    try {
      const knowledge = await this.crossSessionLearning.getRelevantKnowledge(task.description, 3);
      if (knowledge.insights.length > 0) {
        crossSessionInjection = '\n\n## Learned Patterns\n' + 
          knowledge.insights.map(i => `- [${(i.confidenceEma * 100).toFixed(0)}%] ${i.content}`).join('\n');
        log.debug(`Planner v3.9] 📚 Injecting ${knowledge.insights.length} cross-session insights`);
      }
    } catch (e: any) {
      // Ignore errors
    }
    
    // Build prompt with code context, memory, and cross-session knowledge
    const systemPrompt = `You are ${award.winnerRole}. Complete the following task.
Provide a detailed, actionable response.
For each conclusion or recommendation, state your confidence and the key assumption behind it.
If you are uncertain about something, say so explicitly.
If code context is provided, reference the actual code in your response.${memoryInjection}${crossSessionInjection}`;
    
    const userPrompt = `## Task\n\n${task.description}${codeContextMarkdown}\n\n## Your Approach\n\n${award.winningBid.approach}\n\n## Instructions\n\nProvide your complete solution. Reference the actual code shown above when relevant.`;
    
    try {
      // Execute with appropriate model using smart streaming
      const modelSelection = this.modelSelector.selectModelsForTeam([{
        id: award.winnerId,
        role: award.winnerRole,
        expertise: '',
        focus: '',
        perspective: '',
        domain: agent?.capabilities[0]?.domain as any || 'general'
      }]).get(award.winnerId);
      
      const provider = modelSelection?.provider || 'openai';
      const model = modelSelection?.model || 'gpt-5.2-chat-latest';
      
      log.debug(`Planner] Executing with ${provider} model: ${model}`);
      
      // Use smart streaming for long tasks
      const result = await executeWithSmartStreaming(
        this.openaiClient,
        this.anthropicClient,
        provider as 'openai' | 'anthropic',
        model,
        systemPrompt,
        userPrompt,
        {
          onProgress: (chunk, total) => {
            // Progress is logged in streamingExecutor
          }
        }
      );
      
      const output = result.output;
      const tokens = result.tokens;
      
      const latencyMs = Date.now() - startTime;
      
      // Record successful execution in agent memory
      this.agentMemory.recordExecution(
        award.winnerRole,
        task.description,
        award.winningBid.approach,
        output.substring(0, 500),
        true,
        { confidence: award.winningBid.confidence, tokensUsed: tokens, latencyMs }
      );
      
      // Cache successful result for future similar tasks
      this.taskCache.set(
        task.description,
        award.winnerRole,
        output,
        true,
        tokens
      );
      
      return {
        taskId: task.id,
        agentId: award.winnerId,
        success: true,
        output,
        actualCost: tokens,
        actualTime: latencyMs,
        artifacts: [],
        submittedAt: new Date().toISOString()
      };
      
    } catch (error: any) {
      log.debug(`Planner] ❌ Task execution failed: ${error.message}`);
      log.error(`[Planner] Task execution failed: ${error.message}`);
      
      // Record failed execution in agent memory
      this.agentMemory.recordExecution(
        award.winnerRole,
        task.description,
        award.winningBid.approach,
        error.message,
        false,
        { confidence: award.winningBid.confidence, tokensUsed: 0, latencyMs: Date.now() - startTime }
      );
      
      return {
        taskId: task.id,
        agentId: award.winnerId,
        success: false,
        output: `Error: ${error.message}`,
        actualCost: 0,
        actualTime: Date.now() - startTime,
        artifacts: [],
        submittedAt: new Date().toISOString()
      };
    }
  }
  
  /**
   * Estimate tokens for task
   */
  private estimateTokens(task: CNPTask, agent: DynamicAgent): number {
    const baseTokens = 500;
    const descriptionFactor = task.description.length / 100;
    const complexityFactor = task.priority / 50;
    
    return Math.round(baseTokens + descriptionFactor * 100 + complexityFactor * 200);
  }
  
  /**
   * Estimate time for task
   */
  private estimateTime(task: CNPTask, agent: DynamicAgent): number {
    const baseTime = 5000; // 5s base
    const descriptionFactor = task.description.length / 100;
    
    return Math.round(baseTime + descriptionFactor * 2000);
  }
  
  /**
   * Estimate confidence for task
   */
  private estimateConfidence(task: CNPTask, agent: DynamicAgent): number {
    // Check domain match
    const requiredCaps = task.constraints.requiredCapabilities || [];
    const agentDomains = [agent.domain, ...(agent.secondaryDomains || [])];
    
    const matchCount = requiredCaps.filter(cap => 
      agentDomains.includes(cap as any)
    ).length;
    
    const matchRatio = requiredCaps.length > 0 
      ? matchCount / requiredCaps.length 
      : 0.8;
    
    return Math.min(0.95, 0.6 + matchRatio * 0.35);
  }
  
  /**
   * Synthesize all results
   */
  private synthesizeResults(results: CNPResult[], tasks: CNPTask[]): string {
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length === 0) {
      return 'No successful task completions.';
    }
    
    let synthesis = '## Execution Summary\n\n';
    
    for (const result of successfulResults) {
      const task = tasks.find(t => t.id === result.taskId);
      if (task && task.type !== 'goal') {
        synthesis += `### ${task.description}\n\n`;
        synthesis += result.output.substring(0, 1000);
        synthesis += result.output.length > 1000 ? '\n\n[...truncated]\n\n' : '\n\n';
      }
    }
    
    return synthesis;
  }
  
  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(
    results: CNPResult[],
    validations: PlannerResult['validations']
  ): number {
    const successRate = results.filter(r => r.success).length / Math.max(1, results.length);
    const validationPassRate = validations.filter(v => v.passed).length / Math.max(1, validations.length);
    
    return (successRate * 0.6 + validationPassRate * 0.4);
  }
  
  /**
   * Estimate total cost
   */
  private estimateCost(results: CNPResult[]): number {
    const totalTokens = results.reduce((sum, r) => sum + r.actualCost, 0);
    const avgCostPerToken = 0.003 / 1000; // Rough average
    return totalTokens * avgCostPerToken;
  }
  
  /**
   * Store results (v5.0: uses UnifiedMemoryCore)
   */
  private async storeResults(
    goalId: string,
    task: HiveTask,
    results: CNPResult[]
  ): Promise<void> {
    try {
      // Lazy init memory core
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      
      // v5.0: Store using UnifiedMemoryCore at L1 (Task Working Memory)
      await this.memoryCore.store(
        JSON.stringify({
          type: 'planner_coordination',
          goal_id: goalId,
          task_description: task.description,
          results_count: results.length,
          success_count: results.filter(r => r.success).length,
          timestamp: new Date().toISOString(),
          project_path: getProjectPath()
        }),
        {
          level: 'L1',
          source: 'runtime',
          contextKeys: ['hive', 'planner', 'cnp', goalId],
          confidence: 0.9
        }
      );
      
      await this.journal.logFeature({
        name: `Planner - ${goalId}`,
        description: `CNP coordination with ${results.length} subtasks`,
        complexity: results.length > 5 ? 'heavy' : 'medium',
        implementation: `Executed ${results.filter(r => r.success).length}/${results.length} tasks successfully`,
        lessons: ['Used CNP auction-based coordination'],
        patterns: ['cnp-auction', 'task-decomposition', 'gatekeeper-validation']
      });
    } catch (error: any) {
      log.warn(`[Planner] Failed to store results: ${error.message}`);
    }
  }
}

/**
 * Create Planner Orchestrator instance (v5.0: no memory parameter)
 */
export function createPlannerOrchestrator(
  config: APIConfig,
  journal: JournalSystem,
  options?: Partial<PlannerOptions>
): PlannerOrchestrator {
  return new PlannerOrchestrator(config, journal, options);
}
