/**
 * M7 Hive v2.0 - Dynamic Orchestrator
 * 
 * Orchestrates dynamic agent teams created by Hive Architect
 * with optimal model selection per agent.
 * 
 * @version 3.7.0
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { HiveTask, HiveResult } from '../types/task.js';
import { APIConfig } from '../types/api.js';
import { JournalSystem } from '../../journal/journalSystem.js';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v5.1: Use robust JSON parser
import { robustParse } from '../utils/json/index.js';
// v7.0: Real LLM-powered debates
import { DebateEngine, DebateConfig, DebateResult } from '../debate/index.js';

// Intelligence imports
import {
  HiveArchitect,
  ModelSelector,
  DynamicAgent,
  DynamicAgentProposal,
  DynamicHiveResult,
  ModelSelection,
  logExecution,
  getLearningStats
} from '../intelligence/index.js';

// Synthesizer uses the same model as Architect
const SYNTHESIZER_MODEL = 'claude-opus-4-6';

/**
 * Dynamic Hive Orchestrator
 * 
 * Creates dynamic agent teams and executes them with optimal model selection.
 */
export class DynamicHiveOrchestrator {
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;
  private architect: HiveArchitect;
  private modelSelector: ModelSelector;
  private memoryCore: UnifiedMemoryCore | null = null;
  private journal: JournalSystem;
  private debateEngine: DebateEngine;  // v7.0: Real LLM debates
  
  constructor(
    config: APIConfig,
    journal: JournalSystem
  ) {
    this.openaiClient = new OpenAI({
      apiKey: config.openai,
      maxRetries: 3,
      timeout: 180000
    });
    
    this.anthropicClient = new Anthropic({
      apiKey: config.anthropic,
      maxRetries: 3,
      timeout: 180000
    });
    
    this.architect = new HiveArchitect(config.anthropic);
    this.modelSelector = new ModelSelector();
    this.debateEngine = new DebateEngine(this.openaiClient, this.anthropicClient);  // v7.0
    this.journal = journal;
    
    logger.info('[Dynamic Hive] ✅ Initialized with dynamic agent generation');
  }
  
  /**
   * Execute task with dynamic agent team
   */
  async coordinateTask(task: HiveTask): Promise<DynamicHiveResult> {
    const startTime = Date.now();
    const taskId = task.id || randomUUID();
    
    logger.info(`[Dynamic Hive] 🚀 Starting dynamic coordination for: ${task.description.substring(0, 80)}...`);
    
    try {
      // Phase 1: Architect creates team
      const architectStart = Date.now();
      const teamConfig = await this.architect.createTeam(task.description, task.context);
      const architectLatency = Date.now() - architectStart;
      
      logger.info(`[Dynamic Hive] 👥 Team created: ${teamConfig.agents.length} experts, mode: ${teamConfig.executionMode}`);
      
      // Phase 2: Select models for each agent
      const modelSelections = this.modelSelector.selectModelsForTeam(teamConfig.agents);
      
      // Phase 3: Execute agents
      const proposals = await this.executeAgents(
        teamConfig.agents,
        modelSelections,
        task
      );
      
      logger.info(`[Dynamic Hive] ✅ Received ${proposals.length} proposals`);
      
      // Phase 3.5: Debate (v7.0 — real LLM-powered debates)
      let debateResult: DebateResult | undefined;
      let activeProposals = proposals;
      
      if (task.debate_mode && proposals.length > 1) {
        try {
          const debateConfig: Partial<DebateConfig> = {
            maxRounds: task.max_rounds ?? 3,
            budgetCapMultiplier: task.priority === 'speed' ? 1.0 : 2.0
          };
          
          debateResult = await this.debateEngine.debate(activeProposals, task, debateConfig);
          activeProposals = debateResult.finalProposals;
          
          logger.info(
            `[Dynamic Hive] 🗣️ Debate: ${debateResult.totalRounds} rounds, ` +
            `converged=${debateResult.converged}, ` +
            `cost=$${debateResult.totalCost.toFixed(4)}`
          );
        } catch (debateError: any) {
          logger.warn(`[Dynamic Hive] ⚠️ Debate failed, using original proposals: ${debateError.message}`);
          // Fallback: proceed without debate
        }
      }
      
      // Phase 4: Synthesize results (using potentially refined proposals)
      const synthesisStart = Date.now();
      const synthesis = await this.synthesizeProposals(activeProposals, task);
      const synthesisLatency = Date.now() - synthesisStart;
      
      // Calculate total metrics (include debate cost)
      const totalTokens = activeProposals.reduce((sum, p) => sum + p.metrics.tokensUsed, 0)
        + (debateResult?.totalTokens ?? 0);
      const totalCost = activeProposals.reduce((sum, p) => sum + p.metrics.costEstimate, 0)
        + (debateResult?.totalCost ?? 0);
      const totalLatency = Date.now() - startTime;
      
      // Store results
      await this.storeResults(taskId, task, activeProposals, synthesis);
      
      // Log for self-learning
      await this.logForLearning(task.description, activeProposals, synthesis.contributingAgents);
      
      const result: DynamicHiveResult = {
        success: true,
        taskId,
        task: task.description,
        team: teamConfig.agents,
        proposals: activeProposals,
        synthesis,
        debate: debateResult,
        metrics: {
          totalTokens,
          totalCost,
          totalLatencyMs: totalLatency,
          architectLatencyMs: architectLatency,
          synthesisLatencyMs: synthesisLatency,
          debateLatencyMs: debateResult?.totalLatencyMs,
          debateCost: debateResult?.totalCost,
          debateRounds: debateResult?.totalRounds
        },
        recommendations: this.generateRecommendations(activeProposals, teamConfig)
      };
      
      logger.info(`[Dynamic Hive] 🎯 Task completed in ${totalLatency}ms, cost: $${totalCost.toFixed(4)}`);
      
      return result;
      
    } catch (error: any) {
      logger.error(`[Dynamic Hive] ❌ Coordination failed: ${error.message}`);
      
      return {
        success: false,
        taskId,
        task: task.description,
        team: [],
        proposals: [],
        synthesis: {
          content: '',
          confidence: 0,
          contributingAgents: []
        },
        metrics: {
          totalTokens: 0,
          totalCost: 0,
          totalLatencyMs: Date.now() - startTime,
          architectLatencyMs: 0,
          synthesisLatencyMs: 0
        },
        recommendations: ['Task failed - consider breaking into smaller subtasks'],
        error: error.message
      };
    }
  }
  
  /**
   * Execute all agents in parallel
   */
  private async executeAgents(
    agents: DynamicAgent[],
    modelSelections: Map<string, ModelSelection>,
    task: HiveTask
  ): Promise<DynamicAgentProposal[]> {
    
    const promises = agents.map(agent => 
      this.executeAgent(agent, modelSelections.get(agent.id)!, task)
    );
    
    const results = await Promise.allSettled(promises);
    
    const proposals: DynamicAgentProposal[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        proposals.push(result.value);
      } else {
        logger.warn(`[Dynamic Hive] Agent ${agents[i].role} failed: ${result.reason}`);
      }
    }
    
    return proposals;
  }
  
  /**
   * Execute single agent
   */
  /**
   * Execute single agent with retry-on-empty/truncation.
   * Attempt 1: 4096 tokens. Attempt 2 (if needed): 8192 tokens.
   */
  private async executeAgent(
    agent: DynamicAgent,
    modelSelection: ModelSelection,
    task: HiveTask
  ): Promise<DynamicAgentProposal> {
    
    const startTime = Date.now();
    logger.info(`[Dynamic Hive] ⚡ ${agent.role} → ${modelSelection.model}`);
    
    const prompt = this.buildAgentPrompt(agent, task);
    const systemPrompt = this.buildAgentSystemPrompt(agent);
    
    const MAX_ATTEMPTS = 2;
    const TOKEN_BUDGETS = [4096, 8192];
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const maxTokens = TOKEN_BUDGETS[attempt];
        let content: string;
        let tokensUsed: number;
        let costEstimate: number;
        let stopReason: string;
        
        if (modelSelection.provider === 'openai') {
          const result = await this.callOpenAI(modelSelection.model, systemPrompt, prompt, maxTokens);
          content = result.content;
          tokensUsed = result.tokens;
          costEstimate = result.cost;
          stopReason = result.finishReason;
        } else {
          const result = await this.callAnthropic(modelSelection.model, systemPrompt, prompt, maxTokens);
          content = result.content;
          tokensUsed = result.tokens;
          costEstimate = result.cost;
          stopReason = result.stopReason;
        }
        
        // Content validation — retry if empty or truncated
        const isEmpty = !content || content.trim().length === 0;
        const isTruncated = stopReason === 'length' || stopReason === 'max_tokens';
        
        if ((isEmpty || isTruncated) && attempt < MAX_ATTEMPTS - 1) {
          logger.warn(
            `[Dynamic Hive] ⚠️ ${agent.role} attempt ${attempt + 1}: ` +
            `${isEmpty ? 'empty response' : `truncated (${stopReason})`}, ` +
            `retrying with ${TOKEN_BUDGETS[attempt + 1]} tokens...`
          );
          continue;
        }
        
        if (isEmpty) {
          logger.warn(`[Dynamic Hive] ❌ ${agent.role}: empty response after ${MAX_ATTEMPTS} attempts`);
        }
        if (isTruncated) {
          logger.warn(`[Dynamic Hive] ⚠️ ${agent.role}: response truncated (${stopReason}) even at ${maxTokens} tokens`);
        }
        
        const latency = Date.now() - startTime;
        const parsed = this.parseAgentResponse(content);
        
        logger.info(`[Dynamic Hive] ✅ ${agent.role} completed in ${latency}ms (attempt ${attempt + 1}, ${stopReason})`);
        
        return {
          agent,
          model: modelSelection.model,
          provider: modelSelection.provider,
          proposal: parsed.proposal,
          reasoning: parsed.reasoning,
          confidence: parsed.confidence,
          keyAssumptions: parsed.keyAssumptions,
          whatWouldChangeMyMind: parsed.whatWouldChangeMyMind,
          implementationSteps: parsed.implementationSteps,
          requirements: parsed.requirements,
          risks: parsed.risks,
          alternatives: parsed.alternatives,
          estimatedTime: parsed.estimatedTime,
          metrics: {
            tokensUsed,
            latencyMs: latency,
            costEstimate
          }
        };
        
      } catch (error: any) {
        if (attempt < MAX_ATTEMPTS - 1) {
          logger.warn(
            `[Dynamic Hive] ⚠️ ${agent.role} attempt ${attempt + 1} error: ${error.message}, retrying...`
          );
          continue;
        }
        throw error;  // Let Promise.allSettled handle final failure
      }
    }
    
    // TypeScript: unreachable but satisfies compiler
    throw new Error(`${agent.role}: all ${MAX_ATTEMPTS} attempts exhausted`);
  }
  
  private buildAgentSystemPrompt(agent: DynamicAgent): string {
    return `You are ${agent.role}, an expert in ${agent.expertise}.

Your Focus: ${agent.focus}
Your Perspective: ${agent.perspective}

You are part of a team of experts analyzing a complex task together.

Instructions:
1. Analyze the task from your specialized viewpoint
2. For each conclusion, state your honest confidence level and the key assumption it depends on
3. Describe what evidence or conditions would change your mind
4. If another expert's perspective would be stronger on some aspect, say so
5. Do NOT inflate confidence or overstate certainty — accuracy matters more than boldness

Format your response as JSON:
{
  "proposal": "Your analysis and recommendation",
  "reasoning": "Why you reached this conclusion, including what assumptions you are making",
  "confidence": 0.7,
  "key_assumptions": ["assumption that if wrong would change your conclusion"],
  "what_would_change_my_mind": "evidence or conditions that would make you revise this",
  "implementation_steps": ["step1", "step2"],
  "requirements": ["req1", "req2"],
  "risks": ["risk1"],
  "alternatives": ["alt1"],
  "estimated_time": "2-4 hours"
}`;
  }
  
  private buildAgentPrompt(agent: DynamicAgent, task: HiveTask): string {
    let prompt = `## Task\n\n${task.description}`;
    
    if (task.context) {
      prompt += `\n\n## Context\n${JSON.stringify(task.context, null, 2)}`;
    }
    
    prompt += `\n\n## Your Assignment\n\nAs ${agent.role}, analyze this task with focus on ${agent.focus}.\nFor each conclusion, state your confidence and the key assumption behind it.\nIf you are uncertain about something, say so explicitly — calibrated honesty is valued over false certainty.`;
    
    return prompt;
  }
  
  private async callOpenAI(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4096
  ): Promise<{ content: string; tokens: number; cost: number; finishReason: string }> {
    
    const isGPT5 = model.startsWith('gpt-5');
    
    const params: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    };
    
    if (isGPT5) {
      params.max_completion_tokens = maxTokens;
    } else {
      params.max_tokens = maxTokens;
      params.temperature = 0.1;
    }
    
    const response = await this.openaiClient.chat.completions.create(params);
    const tokens = response.usage?.total_tokens || 0;
    
    // Cost calculation (April 2026 — blended in/out average)
    const rates: Record<string, number> = {
      'gpt-5.5': 0.0175 / 1000,
      'gpt-5.5-2026-04-23': 0.0175 / 1000,
      'gpt-5.2': 0.0078 / 1000,
      'gpt-5.1': 0.0056 / 1000,
      'gpt-4.1': 0.005 / 1000,
      'gpt-4.1-mini': 0.001 / 1000,
      'gpt-4.1-nano': 0.00025 / 1000
    };
    const cost = (rates[model] || 0.010 / 1000) * tokens;
    
    return {
      content: response.choices[0].message.content || '',
      tokens,
      cost,
      finishReason: response.choices[0].finish_reason || 'unknown'
    };
  }
  
  private async callAnthropic(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4096
  ): Promise<{ content: string; tokens: number; cost: number; stopReason: string }> {
    
    const response = await this.anthropicClient.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    });
    
    const tokens = response.usage.input_tokens + response.usage.output_tokens;
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Cost calculation (April 2026 — blended in/out average)
    const rates: Record<string, number> = {
      'claude-opus-4-7': 0.015 / 1000,
      'claude-opus-4-6': 0.015 / 1000,
      'claude-opus-4-5-20251101': 0.015 / 1000,
      'claude-sonnet-4-6': 0.009 / 1000,
      'claude-sonnet-4-5-20250929': 0.009 / 1000,
      'claude-haiku-4-5-20251001': 0.003 / 1000
    };
    const cost = (rates[model] || 0.009 / 1000) * tokens;
    
    return { content, tokens, cost, stopReason: response.stop_reason || 'unknown' };
  }
  
  private parseAgentResponse(content: string): any {
    // v5.1: Use robust JSON parser with extraction, repair, and recovery
    const result = robustParse(content);
    
    if (result.success && result.data && typeof result.data === 'object') {
      const parsed = result.data as Record<string, any>;
      return {
        proposal: parsed.proposal || content,
        reasoning: parsed.reasoning || '',
        confidence: result.confidence, // Use pipeline confidence (accounts for repairs)
        keyAssumptions: parsed.key_assumptions || parsed.keyAssumptions || [],
        whatWouldChangeMyMind: parsed.what_would_change_my_mind || parsed.whatWouldChangeMyMind || '',
        implementationSteps: parsed.implementation_steps || parsed.implementationSteps || [],
        requirements: parsed.requirements || [],
        risks: parsed.risks || [],
        alternatives: parsed.alternatives || [],
        estimatedTime: parsed.estimated_time || parsed.estimatedTime
      };
    }
    
    // Fallback for failed parsing
    return {
      proposal: content,
      reasoning: `JSON parse failed: ${result.error}`,
      confidence: 0.3,
      implementationSteps: [],
      requirements: [],
      risks: ['Response parsing failed'],
      alternatives: []
    };
  }
  
  /**
   * Synthesize all proposals into final solution
   */
  private async synthesizeProposals(
    proposals: DynamicAgentProposal[],
    task: HiveTask
  ): Promise<{ content: string; confidence: number; contributingAgents: string[] }> {
    
    if (proposals.length === 0) {
      return {
        content: 'No proposals received from agents',
        confidence: 0,
        contributingAgents: []
      };
    }
    
    if (proposals.length === 1) {
      return {
        content: proposals[0].proposal,
        confidence: proposals[0].confidence,
        contributingAgents: [proposals[0].agent.id]
      };
    }
    
    logger.info('[Dynamic Hive] 🧬 Synthesizing proposals...');
    
    const synthesisPrompt = this.buildSynthesisPrompt(proposals, task);
    
    const response = await this.anthropicClient.messages.create({
      model: SYNTHESIZER_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      system: `You are the Hive Synthesizer. Your role is to analyze expert proposals and produce an honest, calibrated assessment.

Instructions:
1. Where experts AGREE: state the consensus and the shared confidence level
2. Where experts DISAGREE: present the disagreement clearly, explain both sides, and state which position has stronger evidence (or if it is genuinely uncertain)
3. Do NOT force agreement — if experts disagree, that disagreement IS the finding
4. Do NOT inflate confidence — if the evidence is mixed, say so
5. Flag any claims where confidence seems higher than the evidence warrants

Output format:
{
  "synthesis": "Honest assessment combining expert analyses — including areas of agreement and disagreement",
  "consensus_points": ["points where experts agree"],
  "disagreements": ["points where experts disagree, with reasoning from each side"],
  "contributing_experts": ["list of experts whose ideas were incorporated"],
  "confidence": 0.7,
  "key_decisions": ["major decisions made during synthesis"],
  "open_questions": ["unresolved questions that need more investigation"]
}`,
      messages: [
        { role: 'user', content: synthesisPrompt }
      ]
    });
    
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    
    try {
      const parsed = JSON.parse(content);
      
      // Map expert names back to agent IDs
      const contributingAgents = proposals
        .filter(p => parsed.contributing_experts?.some((e: string) => 
          p.agent.role.toLowerCase().includes(e.toLowerCase()) ||
          e.toLowerCase().includes(p.agent.role.toLowerCase())
        ))
        .map(p => p.agent.id);
      
      return {
        content: parsed.synthesis || content,
        confidence: parsed.confidence || 0.7,
        contributingAgents: contributingAgents.length > 0 ? contributingAgents : proposals.map(p => p.agent.id)
      };
    } catch {
      return {
        content,
        confidence: 0.6,
        contributingAgents: proposals.map(p => p.agent.id)
      };
    }
  }
  
  private buildSynthesisPrompt(proposals: DynamicAgentProposal[], task: HiveTask): string {
    let prompt = `## Original Task\n\n${task.description}\n\n## Expert Proposals\n\n`;
    
    for (const p of proposals) {
      prompt += `### ${p.agent.role} (${p.agent.expertise})\n`;
      prompt += `Focus: ${p.agent.focus}\n`;
      prompt += `Confidence: ${(p.confidence * 100).toFixed(0)}%\n\n`;
      prompt += `**Proposal:**\n${p.proposal}\n\n`;
      prompt += `**Reasoning:**\n${p.reasoning}\n\n`;
      
      if (p.keyAssumptions && p.keyAssumptions.length > 0) {
        prompt += `**Key Assumptions:** ${p.keyAssumptions.join('; ')}\n\n`;
      }
      if (p.whatWouldChangeMyMind) {
        prompt += `**Would change mind if:** ${p.whatWouldChangeMyMind}\n\n`;
      }
      if (p.implementationSteps.length > 0) {
        prompt += `**Steps:** ${p.implementationSteps.join(', ')}\n\n`;
      }
      if (p.risks.length > 0) {
        prompt += `**Risks:** ${p.risks.join(', ')}\n\n`;
      }
      prompt += `---\n\n`;
    }
    
    prompt += `## Your Task\n\nAnalyze these ${proposals.length} expert proposals. Identify where they agree (consensus), where they disagree (present both sides), and what remains uncertain. Do not force agreement — honest disagreement is a valid finding.`;
    
    return prompt;
  }
  
  /**
   * Store results in memory and journal
   */
  private async storeResults(
    taskId: string,
    task: HiveTask,
    proposals: DynamicAgentProposal[],
    synthesis: { content: string; confidence: number; contributingAgents: string[] }
  ): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      
      await this.memoryCore.store(JSON.stringify({
        type: 'dynamic_hive_coordination',
        task_id: taskId,
        task_description: task.description,
        team: proposals.map(p => ({
          role: p.agent.role,
          model: p.model,
          confidence: p.confidence
        })),
        synthesis: synthesis.content,
        timestamp: new Date().toISOString(),
        project_path: getProjectPath()
      }), {
        level: 'L1',
        source: 'runtime',
        contextKeys: ['hive', 'dynamic', taskId],
        confidence: synthesis.confidence
      });
      
      await this.journal.logFeature({
        name: `Dynamic Hive - ${taskId}`,
        description: `Dynamic team coordination with ${proposals.length} experts`,
        complexity: proposals.length > 3 ? 'heavy' : 'medium',
        implementation: synthesis.content.substring(0, 500),
        lessons: [`Used dynamic agents: ${proposals.map(p => p.agent.role).join(', ')}`],
        patterns: ['dynamic-agent-generation', 'model-selection', 'synthesis']
      });
    } catch (error: any) {
      logger.warn(`[Dynamic Hive] Failed to store results: ${error.message}`);
    }
  }
  
  /**
   * Log execution for self-learning
   */
  private async logForLearning(
    task: string,
    proposals: DynamicAgentProposal[],
    contributingAgents: string[]
  ): Promise<void> {
    for (const proposal of proposals) {
      const wasUsedInFinal = contributingAgents.includes(proposal.agent.id);
      
      await logExecution(
        task,
        proposal.agent,
        proposal.model,
        proposal.provider,
        proposal.proposal,
        {
          tokensUsed: proposal.metrics.tokensUsed,
          latencyMs: proposal.metrics.latencyMs
        },
        wasUsedInFinal
      );
    }
  }
  
  /**
   * Generate recommendations
   */
  private generateRecommendations(
    proposals: DynamicAgentProposal[],
    teamConfig: { complexity: string; executionMode: string }
  ): string[] {
    const recommendations: string[] = [];
    
    // Confidence analysis
    const avgConfidence = proposals.reduce((sum, p) => sum + p.confidence, 0) / proposals.length;
    if (avgConfidence < 0.6) {
      recommendations.push('Low average confidence - consider adding more context or constraints');
    } else if (avgConfidence > 0.85) {
      recommendations.push('High confidence solution - experts are in strong agreement');
    }
    
    // Diversity analysis
    const uniqueProposals = new Set(proposals.map(p => p.proposal.substring(0, 100)));
    if (uniqueProposals.size === 1) {
      recommendations.push('All experts converged on similar solution - high reliability');
    } else {
      recommendations.push('Diverse expert perspectives - synthesis provides balanced view');
    }
    
    // Risk analysis
    const allRisks = proposals.flatMap(p => p.risks);
    if (allRisks.length > 5) {
      recommendations.push(`${allRisks.length} risks identified - review risk mitigation`);
    }
    
    // Complexity hint
    recommendations.push(`Task complexity: ${teamConfig.complexity}`);
    
    return recommendations;
  }
  
  /**
   * Get learning statistics
   */
  async getLearningStats() {
    return getLearningStats();
  }
}

/**
 * Create Dynamic Hive Orchestrator
 * v5.0: memory parameter removed - uses UnifiedMemoryCore internally
 */
export function createDynamicOrchestrator(
  config: APIConfig,
  journal: JournalSystem
): DynamicHiveOrchestrator {
  return new DynamicHiveOrchestrator(config, journal);
}
