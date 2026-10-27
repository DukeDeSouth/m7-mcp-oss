import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AgentType, AgentConfig, AgentContext, AgentResponse, AgentProposal } from '../types/agent.js';
import { APIConfig, RequestMetrics } from '../types/api.js';
import { ProviderId } from '../types/provider.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
import { discoverModels, getOptimalAgentModels, DiscoveryResult } from './modelDiscovery.js';
import { parseLegacyAgentResponse } from '../utils/json/index.js';
import { withRetry, classifyError, RetryConfig, formatRetryResult } from '../../core/utils/retry.js';
import { ProviderManager } from './providerManager.js';
import { guardContext, analyzeContext, formatAnalysis, ContextGuardConfig, DEFAULT_CONTEXT_GUARD_CONFIG } from '../context/index.js';

export class APIManager {
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;
  private metrics: RequestMetrics[] = [];
  private modelDiscovery: DiscoveryResult | null = null;
  
  // v3.10: Provider health management
  private providerManager: ProviderManager;
  
  // v3.10: Context guard configuration
  private contextGuardConfig: ContextGuardConfig = {
    ...DEFAULT_CONTEXT_GUARD_CONFIG,
    warningThreshold: 80,
    errorThreshold: 95,
    autoTruncate: true,
    logUsage: true,
  };
  
  // v3.10: Retry configuration
  private retryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    jitter: 0.1,
    backoffMultiplier: 2,
    onRetry: (attempt, error, delayMs) => {
      const classified = classifyError(error);
      logger.warn(
        `[Hive API] Retry ${attempt}: [${classified.code}] ${classified.message}, ` +
        `waiting ${Math.round(delayMs)}ms...`
      );
    },
  };
  
  // Default configs (will be updated by model discovery)
  private agentConfigs: Record<AgentType, AgentConfig> = {
    research: {
      id: 'research',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      specialization: 'Deep research, analysis, documentation',
      strengths: ['thorough_analysis', 'context_understanding', 'research'],
      cost_tier: 'premium'
    },
    implementation: {
      id: 'implementation',
      provider: 'openai', 
      model: 'gpt-5.5',
      specialization: 'Fast coding, optimization, debugging',
      strengths: ['code_generation', 'optimization', 'debugging'],
      cost_tier: 'premium'
    },
    architecture: {
      id: 'architecture',
      provider: 'openai',
      model: 'gpt-5.5',
      specialization: 'System design, technical architecture',
      strengths: ['structured_thinking', 'technical_depth', 'patterns'],
      cost_tier: 'premium'
    },
    security: {
      id: 'security',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      specialization: 'Security audit, vulnerabilities, RLS',
      strengths: ['security_awareness', 'risk_analysis', 'careful_reasoning'],
      cost_tier: 'premium'
    },
    testing: {
      id: 'testing',
      provider: 'openai',
      model: 'gpt-5.2',
      specialization: 'Test generation, validation, QA',
      strengths: ['edge_cases', 'comprehensive_testing', 'quality'],
      cost_tier: 'standard'
    },
    performance: {
      id: 'performance',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      specialization: 'Performance optimization, metrics',
      strengths: ['efficiency', 'fast_analysis', 'optimization'],
      cost_tier: 'standard'
    },
    techsafety: {
      id: 'techsafety',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      specialization: 'AI-safe technology assessment, risk analysis',
      strengths: ['technology_awareness', 'risk_assessment', 'alternatives'],
      cost_tier: 'premium'
    }
  };
  
  constructor(config: APIConfig) {
    logger.info('[Hive API] Initializing API clients...');
    
    // v3.10: Initialize provider health manager
    this.providerManager = new ProviderManager();
    
    // v3.10: Disable SDK retries - we use our own retry system
    this.openaiClient = new OpenAI({
      apiKey: config.openai,
      maxRetries: 0,  // Disabled - using M7 retry system
      timeout: 180000  // 3 minutes - guaranteed response time for complex tasks
    });
    logger.info('[Hive API] ✅ OpenAI client initialized');
    
    this.anthropicClient = new Anthropic({
      apiKey: config.anthropic,
      maxRetries: 0,  // Disabled - using M7 retry system
      timeout: 180000  // 3 minutes - guaranteed response time for complex tasks
    });
    logger.info('[Hive API] ✅ Anthropic client initialized');
    
    // v3.6.3: Auto-discover best available models (async, non-blocking)
    this.initializeModelDiscovery(config.openai, config.anthropic).catch(err => 
      logger.warn(`[Hive API] Model discovery failed: ${err.message}`)
    );
  }
  
  /**
   * v3.6.3: Discover and configure optimal models
   */
  private async initializeModelDiscovery(openaiKey: string, anthropicKey: string): Promise<void> {
    try {
      logger.info('[Hive API] 🔍 Starting model discovery...');
      
      this.modelDiscovery = await discoverModels(openaiKey, anthropicKey);
      const optimalModels = getOptimalAgentModels(this.modelDiscovery);
      
      // Update agent configs with discovered models
      for (const [agentId, config] of Object.entries(optimalModels)) {
        const agentType = agentId as AgentType;
        if (this.agentConfigs[agentType]) {
          const oldModel = this.agentConfigs[agentType].model;
          this.agentConfigs[agentType].provider = config.provider;
          this.agentConfigs[agentType].model = config.model;
          
          if (oldModel !== config.model) {
            logger.info(`[Hive API] 🔄 ${agentType}: ${oldModel} → ${config.model}`);
          }
        }
      }
      
      logger.info(`[Hive API] ✅ Model discovery complete`);
      logger.info(`[Hive API] 🤖 OpenAI flagship: ${this.modelDiscovery.openai.flagship}`);
      logger.info(`[Hive API] 🤖 Anthropic flagship: ${this.modelDiscovery.anthropic.flagship}`);
      
    } catch (error: any) {
      logger.warn(`[Hive API] ⚠️ Model discovery failed, using defaults: ${error.message}`);
    }
  }
  
  /**
   * Get current model configuration for an agent
   */
  getAgentModel(agentType: AgentType): { provider: string; model: string } {
    const config = this.agentConfigs[agentType];
    return { provider: config.provider, model: config.model };
  }
  
  /**
   * Get discovery results
   */
  getModelDiscovery(): DiscoveryResult | null {
    return this.modelDiscovery;
  }
  
  async callAgent(
    agentType: AgentType,
    prompt: string,
    context: AgentContext
  ): Promise<AgentResponse> {
    
    const config = this.agentConfigs[agentType];
    const preferredProvider = config.provider as ProviderId;
    const startTime = Date.now();
    
    // v3.10: Check provider health and get best available provider
    let activeProvider = this.providerManager.getProviderForRequest(preferredProvider);
    
    if (!activeProvider) {
      logger.error('[Hive API] No healthy provider available');
      return {
        success: false,
        error: 'All providers unavailable. Please try again later.',
      };
    }
    
    // Track if we're using fallback
    const usingFallback = activeProvider !== preferredProvider;
    if (usingFallback) {
      logger.warn(`[Hive API] Using fallback provider: ${preferredProvider} → ${activeProvider}`);
    }
    
    // v3.10: Apply context window guard
    const guardResult = guardContext(prompt, config.model, {
      config: this.contextGuardConfig,
    });
    
    // Use guarded (potentially truncated) prompt
    const safePrompt = guardResult.content;
    
    if (guardResult.truncated) {
      logger.warn(
        `[Hive API] Context truncated: ${guardResult.originalTokens} → ${guardResult.finalTokens} tokens ` +
        `(${guardResult.strategy} strategy, removed ${guardResult.tokensRemoved})`
      );
    } else if (guardResult.warnings.length > 0) {
      // Log warnings even if not truncated
      guardResult.warnings.forEach(w => logger.warn(`[Hive API] ${w}`));
    }
    
    // v3.10: Use intelligent retry with exponential backoff
    const retryResult = await withRetry(
      async () => {
        const callStartTime = Date.now();
        try {
          let result;
          if (activeProvider === 'openai') {
            result = await this.callOpenAI(config, safePrompt, context);
          } else {
            result = await this.callAnthropic(config, safePrompt, context);
          }
          
          // Record success
          this.providerManager.recordSuccess(activeProvider!, Date.now() - callStartTime);
          return result;
          
        } catch (error) {
          // Record failure and check for failover
          this.providerManager.recordFailureFromError(activeProvider!, error);
          
          // Check if we should failover before re-throwing
          const fallback = this.providerManager.getFallback(activeProvider!);
          if (fallback && !usingFallback) {
            logger.warn(`[Hive API] Attempting failover: ${activeProvider} → ${fallback}`);
            activeProvider = fallback;
            // Don't throw - let retry mechanism try with new provider
          }
          
          throw error;
        }
      },
      this.retryConfig
    );
    
    if (retryResult.success && retryResult.data) {
      const apiResponse = retryResult.data;
      
      // Parse response into AgentProposal
      const proposal = await this.parseAgentResponse(agentType, apiResponse.content);
      
      // Track metrics (including retry and failover info)
      this.trackMetrics({
        agent: agentType,
        model: config.model,
        tokens_input: Math.ceil(prompt.length / 4),
        tokens_output: apiResponse.tokens_used,
        cost: apiResponse.cost_estimate,
        latency: Date.now() - startTime,
        success: true,
        retryAttempts: retryResult.attempts,
        retryDelayMs: retryResult.totalDelayMs,
      });
      
      // Log if retries were needed
      if (retryResult.attempts > 1) {
        logger.info(`[Hive API] ${formatRetryResult(retryResult)}`);
      }
      
      return {
        success: true,
        proposal,
        tokens_used: apiResponse.tokens_used,
        cost_estimate: apiResponse.cost_estimate
      };
      
    } else {
      // All retries failed
      const errorMsg = retryResult.error 
        ? `[${retryResult.error.code}] ${retryResult.error.message}`
        : 'Unknown API error';
      
      logger.error(`[Hive API] ${formatRetryResult(retryResult)}`);
      
      this.trackMetrics({
        agent: agentType,
        model: config.model,
        tokens_input: Math.ceil(prompt.length / 4),
        tokens_output: 0,
        cost: 0,
        latency: Date.now() - startTime,
        success: false,
        retryAttempts: retryResult.attempts,
        retryDelayMs: retryResult.totalDelayMs,
      });
      
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  
  /**
   * v3.10: Get provider health status summary
   */
  getProviderStatus(): string {
    return this.providerManager.getSummary();
  }
  
  /**
   * v3.10: Get provider manager for direct access
   */
  getProviderManager(): ProviderManager {
    return this.providerManager;
  }
  
  /**
   * v3.10: Analyze context before sending to API
   */
  analyzePromptContext(prompt: string, model?: string) {
    const targetModel = model || 'gpt-4o';
    const analysis = analyzeContext(prompt, targetModel);
    return {
      ...analysis,
      formatted: formatAnalysis(analysis),
    };
  }
  
  /**
   * v3.10: Configure context guard settings
   */
  setContextGuardConfig(config: Partial<ContextGuardConfig>): void {
    this.contextGuardConfig = { ...this.contextGuardConfig, ...config };
    logger.info('[Hive API] Context guard config updated');
  }
  
  private async callOpenAI(
    config: AgentConfig,
    prompt: string,
    context: AgentContext
  ) {
    const systemPrompt = this.buildSystemPrompt(config, context);
    
    // GPT-5+ has different parameter requirements (max_completion_tokens, no custom temperature)
    const isGPT5 = config.model.startsWith('gpt-5');
    
    // Build request parameters based on model
    const requestParams: any = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    };
    
    // GPT-5 uses max_completion_tokens and doesn't support custom temperature
    if (isGPT5) {
      requestParams.max_completion_tokens = 4096;
      // temperature defaults to 1 for GPT-5 (only supported value)
    } else {
      requestParams.max_tokens = 4096;
      requestParams.temperature = 0.1;
    }
    
    const response = await this.openaiClient.chat.completions.create(requestParams);
    
    return {
      content: response.choices[0].message.content || '',
      tokens_used: response.usage?.total_tokens || 0,
      cost_estimate: this.calculateOpenAICost(config.model, response.usage?.total_tokens || 0),
      response_time: 0
    };
  }
  
  private async callAnthropic(
    config: AgentConfig,
    prompt: string,
    context: AgentContext
  ) {
    const systemPrompt = this.buildSystemPrompt(config, context);
    
    logger.info(`[Hive API] Calling Anthropic ${config.model} for ${config.id} agent`);
    logger.info(`[Hive API] System prompt length: ${systemPrompt.length}`);
    logger.info(`[Hive API] User prompt length: ${prompt.length}`);
    
    try {
      const response = await this.anthropicClient.messages.create({
        model: config.model,
        max_tokens: 4096,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          { role: 'user', content: prompt }
        ]
      });
      
      logger.info(`[Hive API] ✅ Anthropic response received`);
      logger.info(`[Hive API] Input tokens: ${response.usage.input_tokens}`);
      logger.info(`[Hive API] Output tokens: ${response.usage.output_tokens}`);
      
      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      
      return {
        content,
        tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        cost_estimate: this.calculateAnthropicCost(config.model, response.usage.input_tokens + response.usage.output_tokens),
        response_time: 0
      };
    } catch (error: any) {
      logger.error(`[Hive API] ❌ Anthropic API error for ${config.id} agent:`);
      logger.error(`[Hive API] Error type: ${error.constructor.name}`);
      logger.error(`[Hive API] Error message: ${error.message}`);
      
      if (error.status) {
        logger.error(`[Hive API] HTTP Status: ${error.status}`);
      }
      if (error.headers) {
        logger.error(`[Hive API] Headers:`, error.headers);
      }
      if (error.request_id) {
        logger.error(`[Hive API] Request ID: ${error.request_id}`);
      }
      
      throw error;
    }
  }
  
  private buildSystemPrompt(config: AgentConfig, context: AgentContext): string {
    return `You are a ${config.specialization} specialist working as part of the M7 Hive multiagent system.

Your Role: ${config.specialization}
Your Strengths: ${config.strengths.join(', ')}

Task Context: ${context.task}
${context.existing_code ? `Existing Code Context: ${context.existing_code}` : ''}
${context.constraints ? `Constraints: ${context.constraints.join(', ')}` : ''}

Instructions:
1. Analyze the task from your specialized perspective
2. Provide a detailed proposal with reasoning
3. Include implementation steps, requirements, and risks
4. Format your response as valid JSON with this structure:
{
  "proposal": "Your main solution/approach",
  "reasoning": "Why this approach is optimal", 
  "confidence": 0.8,
  "implementation_steps": ["step1", "step2"],
  "requirements": ["req1", "req2"],
  "risks": ["risk1", "risk2"],
  "alternatives": ["alt1", "alt2"],
  "estimated_time": "2-4 hours"
}

Focus on your specialization but consider the broader system context.`;
  }
  
  private async parseAgentResponse(agentType: AgentType, content: string): Promise<AgentProposal> {
    // Use robust JSON parser with extraction, repair, and recovery
    return parseLegacyAgentResponse(agentType, content);
  }
  
  private calculateOpenAICost(model: string, tokens: number): number {
    // Cost estimates (April 2026 — from OpenAI docs, blended in/out average)
    const rates: Record<string, number> = {
      'gpt-5.5': 0.0175 / 1000,                // $5/$30 per 1M → ~$17.50 avg per 1M
      'gpt-5.5-2026-04-23': 0.0175 / 1000,
      'gpt-5.2': 0.0078 / 1000,                // $1.50/$14 per 1M
      'gpt-5.1': 0.0056 / 1000,                // $1.25/$10 per 1M
      'gpt-4.1': 0.005 / 1000,                 // $2/$8 per 1M
      'gpt-4.1-mini': 0.001 / 1000,            // $0.40/$1.60 per 1M
      'gpt-4.1-nano': 0.00025 / 1000           // $0.10/$0.40 per 1M
    };
    return (rates[model] || 0.010 / 1000) * tokens;
  }
  
  private calculateAnthropicCost(model: string, tokens: number): number {
    // Cost estimates (April 2026 — from Anthropic docs, blended in/out average)
    const rates: Record<string, number> = {
      // Opus 4.7 (current flagship — $5/$25 per 1M)
      'claude-opus-4-7': 0.015 / 1000,
      // Opus 4.6 (previous flagship — $5/$25 per 1M)
      'claude-opus-4-6': 0.015 / 1000,
      // Opus 4.5 ($5/$25 per 1M)
      'claude-opus-4-5-20251101': 0.015 / 1000,
      'claude-opus-4-5': 0.015 / 1000,
      // Sonnet 4.6 (current standard — $3/$15 per 1M)
      'claude-sonnet-4-6': 0.009 / 1000,
      // Sonnet 4.5 ($3/$15 per 1M)
      'claude-sonnet-4-5-20250929': 0.009 / 1000,
      'claude-sonnet-4-5': 0.009 / 1000,
      // Haiku 4.5 (economy — $1/$5 per 1M)
      'claude-haiku-4-5-20251001': 0.003 / 1000,
      'claude-haiku-4-5': 0.003 / 1000
    };
    return (rates[model] || 0.009 / 1000) * tokens;
  }
  
  private trackMetrics(metrics: RequestMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 1000 requests
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }
  
  getMetrics(): RequestMetrics[] {
    return [...this.metrics];
  }
  
  getTotalCost(): number {
    return this.metrics.reduce((sum, m) => sum + m.cost, 0);
  }
}
