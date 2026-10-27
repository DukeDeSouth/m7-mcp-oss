import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[ContextProvider]');
/**
 * M7 v3.1 - Context Provider
 * 
 * Provides current time and available AI models for context injection
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { ModelCache } from './model-cache.js';
import {
  CurrentContext,
  AvailableModels,
  ModelInfo,
  ContextProviderConfig,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_FALLBACK_MODELS,
} from './types.js';

/**
 * Context Provider - provides time and model context for AI
 */
export class ContextProvider {
  private cache: ModelCache;
  private config: ContextProviderConfig;
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;

  constructor(config?: Partial<ContextProviderConfig>) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    this.cache = new ModelCache(this.config.cacheTtlMs);
    
    // Initialize API clients if keys available
    this.initClients();
  }

  /**
   * Initialize API clients from environment
   */
  private initClients(): void {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (openaiKey) {
      this.openaiClient = new OpenAI({
        apiKey: openaiKey,
        timeout: this.config.timeout,
        maxRetries: 1,
      });
    }

    if (anthropicKey) {
      this.anthropicClient = new Anthropic({
        apiKey: anthropicKey,
        timeout: this.config.timeout,
        maxRetries: 1,
      });
    }
  }

  /**
   * Get current context (time + models)
   */
  async getContext(): Promise<CurrentContext> {
    if (!this.config.enabled) {
      return this.buildEmptyContext();
    }

    const time = this.getCurrentTime();
    const models = await this.getAvailableModels();
    const header = this.buildHeader(time.formatted, models);

    return {
      timestamp: time.timestamp,
      formattedTime: time.formatted,
      models,
      header,
    };
  }

  /**
   * Get current time
   */
  getCurrentTime(): { timestamp: string; formatted: string } {
    const now = new Date();
    return {
      timestamp: now.toISOString(),
      formatted: now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    };
  }

  /**
   * Get available models (cached or fresh)
   */
  async getAvailableModels(): Promise<AvailableModels> {
    // Check cache first
    const cached = this.cache.get();
    if (cached) {
      return cached;
    }

    // Fetch fresh models
    const models = await this.fetchModels();
    this.cache.set(models);
    return models;
  }

  /**
   * Fetch models from APIs
   */
  private async fetchModels(): Promise<AvailableModels> {
    const [openaiModels, anthropicModels] = await Promise.all([
      this.fetchOpenAIModels(),
      this.fetchAnthropicModels(),
    ]);

    return {
      openai: openaiModels,
      anthropic: anthropicModels,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Fetch OpenAI models
   */
  private async fetchOpenAIModels(): Promise<ModelInfo[]> {
    if (!this.openaiClient) {
      log.debug('ContextProvider] OpenAI client not initialized, using fallback');
      return this.config.fallbackModels.openai;
    }

    try {
      const response = await this.openaiClient.models.list();
      
      // Get all GPT models, sorted by creation date (newest first)
      const gptModels = response.data
        .filter(m => m.id.toLowerCase().startsWith('gpt-'))
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .slice(0, 15) // Show more models for better context
        .map(m => ({
          id: m.id,
          name: this.formatOpenAIModelName(m.id),
          created: m.created,
        }));

      if (gptModels.length === 0) {
        return this.config.fallbackModels.openai;
      }

      return gptModels;
    } catch (error: any) {
      log.debug(`ContextProvider] OpenAI models.list() failed: ${error.message}`);
      return this.config.fallbackModels.openai;
    }
  }

  /**
   * Fetch Anthropic models
   */
  private async fetchAnthropicModels(): Promise<ModelInfo[]> {
    if (!this.anthropicClient) {
      log.debug('ContextProvider] Anthropic client not initialized, using fallback');
      return this.config.fallbackModels.anthropic;
    }

    try {
      const response = await this.anthropicClient.models.list();
      
      // Get Claude models
      const claudeModels = response.data
        .slice(0, 10)
        .map(m => ({
          id: m.id,
          name: m.display_name || m.id,
          created: m.created_at ? new Date(m.created_at).getTime() / 1000 : undefined,
        }));

      if (claudeModels.length === 0) {
        return this.config.fallbackModels.anthropic;
      }

      return claudeModels;
    } catch (error: any) {
      log.debug(`ContextProvider] Anthropic models.list() failed: ${error.message}`);
      return this.config.fallbackModels.anthropic;
    }
  }

  /**
   * Format OpenAI model name for display
   */
  private formatOpenAIModelName(id: string): string {
    // gpt-5.2 → GPT-5.2
    // gpt-4o-2024-08-06 → GPT-4o
    // gpt-4-turbo → GPT-4 Turbo
    // gpt-5.2-chat-latest → GPT-5.2
    const cleaned = id
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-(\d{4}-\d{2}-\d{2})$/, '') // Remove date suffix
      .replace(/-chat-latest$/, '')
      .replace(/-chat$/, '')
      .replace(/-latest$/, '')
      .replace(/-preview$/, '')
      .replace(/-pro$/, ' Pro')
      .replace(/-turbo/i, ' Turbo')
      .replace(/-mini/i, ' Mini');
    return cleaned;
  }

  /**
   * Build Markdown header for injection
   */
  buildHeader(formattedTime: string, models: AvailableModels): string {
    const openaiTop = models.openai.slice(0, 8).map(m => m.name).join(', ');
    const anthropicTop = models.anthropic.slice(0, 5).map(m => m.name).join(', ');
    
    // Determine current model (Claude Opus 4.5 in this case)
    const currentModel = 'Claude Opus 4.5';
    
    const isFromApi = models.lastUpdated !== 'fallback';
    const sourceIndicator = isFromApi ? '(live from APIs)' : '(fallback data)';

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 **CURRENT CONTEXT** ${sourceIndicator}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕐 **Time:** ${formattedTime}
⚠️ *Your dataset is ~1 year behind. Always verify versions!*

🤖 **Available Models:**
   **OpenAI:** ${openaiTop}
   **Anthropic:** ${anthropicTop}

📦 **You are:** ${currentModel}

💡 *Use Context7 to verify library versions!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Build empty context (when disabled)
   */
  private buildEmptyContext(): CurrentContext {
    const time = this.getCurrentTime();
    return {
      timestamp: time.timestamp,
      formattedTime: time.formatted,
      models: DEFAULT_FALLBACK_MODELS,
      header: '',
    };
  }

  /**
   * Clear model cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextProviderConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.cacheTtlMs) {
      this.cache = new ModelCache(config.cacheTtlMs);
    }
  }
}

// Singleton instance
let instance: ContextProvider | null = null;

/**
 * Get ContextProvider singleton
 */
export function getContextProvider(): ContextProvider {
  if (!instance) {
    instance = new ContextProvider();
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetContextProvider(): void {
  instance = null;
}

