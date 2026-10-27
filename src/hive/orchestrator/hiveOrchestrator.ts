import { HiveTask, HiveResult } from '../types/task.js';
import { AgentType, AgentProposal } from '../types/agent.js';
import { APIManager } from '../api/apiManager.js';
import { BaseAgent } from '../agents/baseAgent.js';
import { ResearchAgent } from '../agents/researchAgent.js';
import { ImplementationAgent } from '../agents/implementationAgent.js';
import { ArchitectureAgent } from '../agents/architectureAgent.js';
import { SecurityAgent } from '../agents/securityAgent.js';
import { TestingAgent } from '../agents/testingAgent.js';
import { PerformanceAgent } from '../agents/performanceAgent.js';
import { TechSafetyAgent } from '../agents/techSafetyAgent.js';
import { JournalSystem } from '../../journal/journalSystem.js';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { TSISystem } from '../../tsi/tsiSystem.js';
import { getCrossSessionLearning, CrossSessionLearning, RelevantKnowledge } from '../../cross-session/index.js';
import { createLogger } from '../../core/utils/logger.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v6.0: Consensus Engine for weighted voting and conflict resolution
import { ConsensusEngine, ConsensusConfig, ConsensusResult, DEFAULT_CONSENSUS_CONFIG } from '../consensus/index.js';

const log = createLogger('[Hive]');

export class HiveOrchestrator {
  private apiManager: APIManager;
  private agents: Map<AgentType, BaseAgent> = new Map();
  private memoryCore: UnifiedMemoryCore | null = null;
  private journal: JournalSystem;
  private tsiSystem: TSISystem;
  private crossSessionLearning: CrossSessionLearning;  // v3.9
  private consensusEngine: ConsensusEngine;  // v6.0: Weighted voting & conflict resolution
  
  constructor(
    apiManager: APIManager,
    journal: JournalSystem
  ) {
    this.apiManager = apiManager;
    this.journal = journal;
    this.tsiSystem = new TSISystem();
    this.crossSessionLearning = getCrossSessionLearning();  // v3.9
    this.consensusEngine = new ConsensusEngine();  // v6.0
    
    try {
      log.debug('🚀 Starting agent initialization...');
      
      // Initialize all 6 agents
      log.debug('Initializing research agent...');
      this.agents.set('research', new ResearchAgent('research', apiManager));
      
      log.debug('Initializing implementation agent...');
      this.agents.set('implementation', new ImplementationAgent('implementation', apiManager));
      
      log.debug('Initializing architecture agent...');
      this.agents.set('architecture', new ArchitectureAgent('architecture', apiManager));
      
      log.debug('Initializing security agent...');
      this.agents.set('security', new SecurityAgent('security', apiManager));
      
      log.debug('Initializing testing agent...');
      this.agents.set('testing', new TestingAgent('testing', apiManager));
      
      log.debug('Initializing performance agent...');
      this.agents.set('performance', new PerformanceAgent('performance', apiManager));
      
      log.debug('Initializing techsafety agent...');
      this.agents.set('techsafety', new TechSafetyAgent('techsafety', apiManager));
      
      log.debug('✅ All 7 agents initialized successfully');
    } catch (error: any) {
      log.debug('❌ Agent initialization failed:', error.message);
      log.debug('❌ Stack:', error.stack);
      throw error;
    }
  }
  
  async coordinateTask(task: HiveTask): Promise<HiveResult> {
    const startTime = Date.now();
    log.debug(`Starting coordination for task: ${task.id}`);
    
    try {
      // v3.9: Enrich task with Cross-Session Learning knowledge
      try {
        await this.crossSessionLearning.initialize();
        const knowledge = await this.crossSessionLearning.getRelevantKnowledge(task.description, 5);
        
        if (knowledge.insights.length > 0 || knowledge.heuristics.length > 0) {
          if (!task.context) task.context = {};
          task.context.cross_session_knowledge = knowledge;
          task.context.cross_session_prompt = await this.crossSessionLearning.formatContextForPrompt(task.description);
          log.debug(`✓ Cross-Session: ${knowledge.insights.length} insights, ${knowledge.heuristics.length} heuristics injected`);
        }
      } catch (e: any) {
        log.debug(`Cross-Session injection skipped: ${e.message}`);
      }
      
      // Phase 2: Enrich task with TSI patterns if enabled
      if (task.context?.tsi_enabled) {
        log.debug('🛡️  TSI Integration enabled - enriching task with safety patterns...');
        
        try {
          // Extract technologies from task description
          const technologies = this.extractTechnologies(task.description);
          log.debug(`📋 Detected technologies: ${technologies.join(', ')}`);
          
          if (technologies.length > 0) {
            // Get patterns for each technology
            const allPatterns = [];
            for (const tech of technologies) {
              try {
                // Get all patterns for technology (no category filter)
                const patterns = await this.tsiSystem.getPatterns(tech);
                
                // Filter by confidence threshold locally
                const filteredPatterns = patterns.filter(p => p.confidence >= 0.7);
                allPatterns.push(...filteredPatterns);
                log.debug(`✅ Loaded ${filteredPatterns.length} patterns for ${tech} (filtered by confidence >= 0.7)`);
              } catch (err: any) {
                log.debug(`⚠️  Could not load patterns for ${tech}: ${err.message}`);
              }
            }
            
            // Add patterns to task context
            if (!task.context) task.context = {};
            task.context.tsi_patterns = allPatterns;
            
            log.debug(`✅ TSI enrichment complete: ${allPatterns.length} total patterns loaded`);
          }
        } catch (error: any) {
          log.debug('⚠️  TSI enrichment failed:', error.message);
          // Continue without TSI patterns
        }
      }
      
      // Select agents for task
      const selectedAgents = this.selectAgentsForTask(task);
      log.debug(`Selected agents: ${selectedAgents.join(', ')}`);
      
      // Execute agents in parallel
      const proposals = await this.executeAgentsParallel(selectedAgents, task);
      log.debug(`Received ${proposals.length} proposals`);
      
      // v6.0: Use ConsensusEngine when debate_mode is enabled
      const useConsensus = task.debate_mode && proposals.length > 1;
      let selectedProposal: AgentProposal;
      let consensusResult: ConsensusResult | undefined;
      
      if (useConsensus) {
        log.debug('🗳️  Debate mode enabled - using ConsensusEngine');
        
        // Configure consensus based on task priority
        const consensusConfig: Partial<ConsensusConfig> = {
          ...DEFAULT_CONSENSUS_CONFIG,
          debate: {
            ...DEFAULT_CONSENSUS_CONFIG.debate,
            maxRounds: task.max_rounds ?? 3
          }
        };
        
        // Override for speed priority
        if (task.priority === 'speed') {
          consensusConfig.enableIterativeRefinement = false;
          consensusConfig.debate!.maxRounds = 1;
        }
        
        // Override for consensus priority
        if (task.priority === 'consensus') {
          consensusConfig.unanimityThreshold = 0.95;
          consensusConfig.debate!.requireUnanimity = true;
        }
        
        // Build consensus
        const engine = new ConsensusEngine(consensusConfig);
        consensusResult = await engine.buildConsensus(proposals, task.description);
        
        selectedProposal = consensusResult.selectedProposal;
        
        log.debug(`🎯 Consensus reached: ${consensusResult.method} (${consensusResult.totalRounds} rounds)`);
        log.debug(`   Winner: ${selectedProposal.agentId} (confidence: ${(consensusResult.confidence * 100).toFixed(1)}%)`);
        log.debug(`   Conflicts: ${consensusResult.conflicts.length} (resolved: ${consensusResult.resolvedConflicts})`);
        
        if (consensusResult.minorityOpinions.length > 0) {
          log.debug(`   Minority opinions: ${consensusResult.minorityOpinions.length}`);
          for (const opinion of consensusResult.minorityOpinions) {
            log.debug(`     - ${opinion.agentId}: ${opinion.concernLevel}`);
          }
        }
      } else {
        // Legacy: simple best proposal selection
        selectedProposal = this.selectBestProposal(proposals, task);
        log.debug(`Selected proposal from: ${selectedProposal.agentId}`);
      }
      
      // Store results in M7 memory
      await this.storeResults(task, proposals, selectedProposal, consensusResult);
      
      const executionTime = Date.now() - startTime;
      const totalCost = this.apiManager.getTotalCost();
      
      // Build result with consensus details if available
      const result: HiveResult = {
        success: true,
        task_id: task.id,
        selected_solution: selectedProposal,
        all_proposals: proposals,
        execution_time: executionTime,
        total_cost: totalCost,
        agents_used: selectedAgents,
        recommendations: consensusResult 
          ? [...consensusResult.recommendations, ...this.generateRecommendations(proposals)]
          : this.generateRecommendations(proposals)
      };
      
      // Add consensus-specific fields
      if (consensusResult) {
        result.consensus = {
          method: consensusResult.method,
          confidence: consensusResult.confidence,
          totalRounds: consensusResult.totalRounds,
          conflicts: consensusResult.conflicts.length,
          resolvedConflicts: consensusResult.resolvedConflicts,
          convergenceScore: consensusResult.convergenceScore,
          minorityOpinions: consensusResult.minorityOpinions.map(m => ({
            agentId: m.agentId,
            concernLevel: m.concernLevel,
            reason: m.reason
          })),
          warnings: consensusResult.warnings
        };
      }
      
      return result;
      
    } catch (error: any) {
      log.debug(`Coordination failed:`, error);
      
      // Fallback to single agent
      return await this.fallbackToSingleAgent(task);
    }
  }
  
  private extractTechnologies(description: string): string[] {
    // Extract technology names from task description
    const techPatterns = [
      /\b(react|vue|angular|svelte|solid)\b/gi,
      /\b(node\.?js|deno|bun)\b/gi,
      /\b(typescript|javascript)\b/gi,
      /\b(next\.?js|nuxt|remix|astro)\b/gi,
      /\b(express|fastify|koa|hapi)\b/gi,
      /\b(postgres|mongodb|mysql|redis)\b/gi,
      /\b(docker|kubernetes|k8s)\b/gi,
      /\b(graphql|rest|trpc)\b/gi,
      /\b(tailwind|styled-components|emotion)\b/gi,
      /\b(prisma|drizzle|typeorm)\b/gi,
      /\b(redux|zustand|jotai|recoil)\b/gi
    ];
    
    const matches = new Set<string>();
    
    for (const pattern of techPatterns) {
      const found = description.match(pattern);
      if (found) {
        found.forEach(tech => matches.add(tech.toLowerCase().replace(/\./g, '')));
      }
    }
    
    return Array.from(matches);
  }
  
  private selectAgentsForTask(task: HiveTask): AgentType[] {
    // Если агенты явно указаны, используем их
    if (task.agents && task.agents.length > 0) {
      return task.agents;
    }
    
    // Автоматический выбор агентов
    const selectedAgents: AgentType[] = ['research', 'implementation'];
    
    // Проверяем наличие проблемных технологий
    const techKeywords = ['typescript', 'next.js', 'nextjs', 'tailwind', 'prisma', 'graphql', 'redux', 'server components'];
    const taskLower = task.description.toLowerCase();
    
    if (techKeywords.some(keyword => taskLower.includes(keyword))) {
      selectedAgents.push('techsafety');
      log.debug('⚠️ TechSafety agent added - problematic technologies detected');
    }
    
    // Добавляем architecture для сложных задач
    if (taskLower.includes('architecture') || taskLower.includes('design') || taskLower.includes('structure')) {
      selectedAgents.push('architecture');
    }
    
    return selectedAgents;
  }
  
  private async executeAgentsParallel(
    agentTypes: AgentType[],
    task: HiveTask
  ): Promise<AgentProposal[]> {
    
    log.debug(`🚀 Executing agents in parallel: ${agentTypes.join(', ')}`);
    
    const agentTasks = agentTypes.map(async (agentType) => {
      const agent = this.agents.get(agentType);
      if (!agent) {
        const error = `Agent ${agentType} not available`;
        log.debug(`❌ ${error}`);
        throw new Error(error);
      }
      
      log.debug(`⚡ Starting ${agentType} agent...`);
      
      try {
        const result = await agent.analyzeTask(task.description, {
          task: task.description,
          project_context: task.context
        });
        log.debug(`✅ ${agentType} agent completed successfully`);
        return result;
      } catch (error: any) {
        log.debug(`❌ ${agentType} agent failed:`, error.message);
        throw error;
      }
    });
    
    try {
      const results = await Promise.all(agentTasks);
      log.debug(`🎯 All agents completed. Results: ${results.length}`);
      return results;
    } catch (error: any) {
      log.debug(`💥 Agent execution failed:`, error.message);
      throw error;
    }
  }
  
  private selectBestProposal(proposals: AgentProposal[], task?: HiveTask): AgentProposal {
    // Phase 2: Unified Intelligence - combine AI + TSI + Context7
    
    let bestProposal = proposals[0];
    let bestScore = this.calculateProposalScore(bestProposal, task);
    
    for (const proposal of proposals.slice(1)) {
      const score = this.calculateProposalScore(proposal, task);
      if (score > bestScore) {
        bestProposal = proposal;
        bestScore = score;
      }
    }
    
    // Update proposal with unified confidence
    if (task) {
      bestProposal.confidence = this.calculateUnifiedConfidence(bestProposal, task);
    }
    
    return bestProposal;
  }
  
  private calculateProposalScore(proposal: AgentProposal, task?: HiveTask): number {
    // Phase 2: Unified scoring with TSI + Context7
    let score = proposal.confidence;
    
    // Bonus for detailed implementation steps
    if (proposal.implementation_steps && proposal.implementation_steps.length > 0) {
      score += 0.1;
    }
    
    // Bonus for identifying requirements
    if (proposal.requirements && proposal.requirements.length > 0) {
      score += 0.1;
    }
    
    // Penalty for identified risks (but not too much)
    if (proposal.risks && proposal.risks.length > 2) {
      score -= 0.05;
    }
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Phase 2: Unified Intelligence - Calculate confidence from multiple sources
   * Combines AI agent confidence + TSI pattern confidence + Context7 doc match
   */
  private calculateUnifiedConfidence(proposal: AgentProposal, task: HiveTask): number {
    let totalWeight = 0;
    let weightedSum = 0;
    
    // 1. Agent AI confidence (base - 50% weight)
    const aiConfidence = proposal.confidence;
    weightedSum += aiConfidence * 0.5;
    totalWeight += 0.5;
    
    log.debug(`🤖 AI Confidence: ${(aiConfidence * 100).toFixed(1)}% (weight: 50%)`);
    
    // 2. TSI Pattern confidence (30% weight if available)
    if (task.context?.tsi_patterns && task.context.tsi_patterns.length > 0) {
      const relevantPatterns = this.findRelevantPatterns(proposal, task.context.tsi_patterns);
      
      if (relevantPatterns.length > 0) {
        const avgTsiConfidence = relevantPatterns.reduce(
          (sum, p) => sum + p.confidence,
          0
        ) / relevantPatterns.length;
        
        weightedSum += avgTsiConfidence * 0.3;
        totalWeight += 0.3;
        
        log.debug(`🛡️  TSI Confidence: ${(avgTsiConfidence * 100).toFixed(1)}% (${relevantPatterns.length} patterns, weight: 30%)`);
      }
    }
    
    // 3. Context7 Doc match (20% weight if available)
    if (task.context?.context7_docs) {
      const docMatchScore = this.calculateDocMatchScore(proposal, task.context.context7_docs);
      
      weightedSum += docMatchScore * 0.2;
      totalWeight += 0.2;
      
      log.debug(`📚 Context7 Match: ${(docMatchScore * 100).toFixed(1)}% (weight: 20%)`);
    }
    
    // Calculate unified confidence
    const unifiedConfidence = totalWeight > 0 ? weightedSum / totalWeight : aiConfidence;
    
    log.debug(`🎯 Unified Confidence: ${(unifiedConfidence * 100).toFixed(1)}% (combined from ${Math.round(totalWeight * 100)}% of possible sources)`);
    
    return unifiedConfidence;
  }
  
  private findRelevantPatterns(proposal: AgentProposal, patterns: any[]): any[] {
    // Find patterns mentioned or relevant to the proposal
    const proposalText = (proposal.proposal + ' ' + proposal.reasoning).toLowerCase();
    
    return patterns.filter(pattern => {
      const patternName = pattern.name.toLowerCase();
      const patternTech = pattern.technology.toLowerCase();
      
      // Check if pattern is mentioned or relevant
      return proposalText.includes(patternName) || 
             proposalText.includes(patternTech) ||
             proposalText.includes(pattern.category);
    });
  }
  
  private calculateDocMatchScore(proposal: AgentProposal, docs: string): number {
    // Simple keyword matching between proposal and Context7 docs
    const proposalKeywords = this.extractKeywords(proposal.proposal);
    const docKeywords = this.extractKeywords(docs);
    
    if (proposalKeywords.length === 0) return 0.5; // neutral if no keywords
    
    const intersection = proposalKeywords.filter(k => docKeywords.includes(k));
    const matchRatio = intersection.length / proposalKeywords.length;
    
    // Scale 0-1 but boost baseline to 0.5 (benefit of doubt)
    return 0.5 + (matchRatio * 0.5);
  }
  
  private extractKeywords(text: string): string[] {
    // Extract meaningful keywords (3+ chars, alphanumeric)
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);
    
    // Remove common words
    const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'will', 'should', 'can', 'are', 'was', 'been']);
    
    return words.filter(w => !stopWords.has(w));
  }
  
  private async storeResults(
    task: HiveTask,
    proposals: AgentProposal[],
    selectedProposal: AgentProposal,
    consensusResult?: ConsensusResult
  ): Promise<void> {
    
    // v5.0: Store in UnifiedMemoryCore at L1 (task working memory)
    try {
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      
      const memoryEntry: Record<string, any> = {
        type: 'hive_coordination',
        task_id: task.id,
        task_description: task.description,
        agents_used: proposals.map(p => p.agentId),
        selected_agent: selectedProposal.agentId,
        selected_proposal: selectedProposal,
        timestamp: new Date().toISOString(),
        project_path: getProjectPath()
      };
      
      // v6.0: Add consensus details if available
      if (consensusResult) {
        memoryEntry.consensus = {
          method: consensusResult.method,
          confidence: consensusResult.confidence,
          rounds: consensusResult.totalRounds,
          conflicts: consensusResult.conflicts.length,
          convergence: consensusResult.convergenceScore
        };
      }
      
      await this.memoryCore.store(JSON.stringify(memoryEntry), {
        level: 'L1',
        source: 'runtime',
        contextKeys: ['hive', task.id, selectedProposal.agentId],
        confidence: consensusResult?.confidence ?? selectedProposal.confidence
      });
    } catch (e) {
      log.warn('Failed to store results in memory:', e);
    }
    
    // Log in M7 journal
    const lessons = [`Selected ${selectedProposal.agentId} agent solution`];
    if (consensusResult) {
      lessons.push(`Consensus method: ${consensusResult.method}`);
      if (consensusResult.conflicts.length > 0) {
        lessons.push(`Resolved ${consensusResult.resolvedConflicts}/${consensusResult.conflicts.length} conflicts`);
      }
    }
    
    await this.journal.logFeature({
      name: `Hive Coordination - ${task.id}`,
      description: `Multiagent coordination with ${proposals.length} agents${consensusResult ? ' (consensus)' : ''}`,
      complexity: proposals.length > 2 ? 'heavy' : 'medium',
      implementation: selectedProposal.proposal,
      lessons,
      patterns: consensusResult 
        ? [`${proposals.length}-agent consensus (${consensusResult.method})`]
        : [`${proposals.length}-agent coordination pattern`]
    });
  }
  
  private generateRecommendations(proposals: AgentProposal[]): string[] {
    const recommendations: string[] = [];
    
    // Analyze proposal diversity
    const confidenceScores = proposals.map(p => p.confidence);
    const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
    
    if (avgConfidence < 0.6) {
      recommendations.push('Low confidence scores - consider adding more context or constraints');
    }
    
    // Check for unanimous agreement
    const uniqueApproaches = new Set(proposals.map(p => p.proposal.toLowerCase()));
    if (uniqueApproaches.size === 1) {
      recommendations.push('All agents agree on approach - high confidence solution');
    } else {
      recommendations.push('Agents proposed different approaches - consider hybrid solution');
    }
    
    return recommendations;
  }
  
  private async fallbackToSingleAgent(task: HiveTask): Promise<HiveResult> {
    log.warn(`[Hive] Falling back to single agent mode`);
    
    // Use implementation agent as fallback
    const agent = this.agents.get('implementation');
    if (!agent) {
      throw new Error('No fallback agent available');
    }
    
    const proposal = await agent.analyzeTask(task.description, {
      task: task.description,
      project_context: task.context
    });
    
    return {
      success: true,
      task_id: task.id,
      selected_solution: proposal,
      all_proposals: [proposal],
      execution_time: 0,
      total_cost: 0,
      agents_used: ['implementation'],
      fallback_used: true,
      recommendations: ['Multiagent coordination failed, used single agent fallback']
    };
  }
}
