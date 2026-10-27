import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[ClientPool]');

/**
 * M7 Hive API Client Pool
 * 
 * Singleton pool for OpenAI and Anthropic clients.
 * Provides connection reuse across all Hive components.
 * 
 * Benefits:
 * - Single initialization per provider
 * - Consistent timeout/retry settings
 * - Reduced cold-start latency
 * - Centralized configuration
 * 
 * @version 3.9.0
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Client pool configuration
 */
export interface ClientPoolConfig {
  openaiKey?: string;
  anthropicKey?: string;
  
  // Timeout settings (ms)
  defaultTimeout?: number;
  architectTimeout?: number;  // Longer for complex planning
  embeddingTimeout?: number;  // Shorter for embeddings
  discoveryTimeout?: number;  // Short for model discovery
  
  // Retry settings
  maxRetries?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ClientPoolConfig, 'openaiKey' | 'anthropicKey'>> = {
  defaultTimeout: 180000,     // 3 minutes
  architectTimeout: 120000,   // 2 minutes for architect
  embeddingTimeout: 30000,    // 30 seconds for embeddings
  discoveryTimeout: 10000,    // 10 seconds for discovery
  maxRetries: 3
};

/**
 * Client types for different use cases
 */
export type ClientType = 
  | 'default'      // Standard operations (180s timeout)
  | 'architect'    // Planning/decomposition (120s timeout)
  | 'embedding'    // Vector embeddings (30s timeout)
  | 'discovery';   // Model discovery (10s timeout)

/**
 * Singleton API Client Pool
 */
class APIClientPool {
  private static instance: APIClientPool | null = null;
  
  private config: Required<Omit<ClientPoolConfig, 'openaiKey' | 'anthropicKey'>> & 
                  Pick<ClientPoolConfig, 'openaiKey' | 'anthropicKey'>;
  
  // Cached clients by type
  private openaiClients: Map<ClientType, OpenAI> = new Map();
  private anthropicClients: Map<ClientType, Anthropic> = new Map();
  
  // Initialization status
  private initialized: boolean = false;
  
  private constructor() {
    this.config = {
      ...DEFAULT_CONFIG,
      openaiKey: process.env.OPENAI_API_KEY,
      anthropicKey: process.env.ANTHROPIC_API_KEY
    };
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): APIClientPool {
    if (!APIClientPool.instance) {
      APIClientPool.instance = new APIClientPool();
    }
    return APIClientPool.instance;
  }
  
  /**
   * Initialize pool with API keys
   * Call once at application startup
   */
  initialize(config: ClientPoolConfig): void {
    if (this.initialized) {
      log.debug('[ClientPool] Already initialized, updating keys only');
    }
    
    // Update config
    this.config = {
      ...this.config,
      ...config
    };
    
    // Clear existing clients to force re-creation with new keys
    this.openaiClients.clear();
    this.anthropicClients.clear();
    
    this.initialized = true;
    log.debug(`[ClientPool] ✅ Initialized (OpenAI: ${this.config.openaiKey ? 'yes' : 'no'}, Anthropic: ${this.config.anthropicKey ? 'yes' : 'no'})`);
  }
  
  /**
   * Get OpenAI client for specific use case
   */
  getOpenAI(type: ClientType = 'default'): OpenAI {
    if (!this.config.openaiKey) {
      throw new Error('OpenAI API key not configured. Call initialize() first.');
    }
    
    // Return cached client if exists
    let client = this.openaiClients.get(type);
    if (client) {
      return client;
    }
    
    // Create new client with appropriate timeout
    const timeout = this.getTimeout(type);
    client = new OpenAI({
      apiKey: this.config.openaiKey,
      maxRetries: this.config.maxRetries,
      timeout
    });
    
    this.openaiClients.set(type, client);
    log.debug(`[ClientPool] 🔧 Created OpenAI client (${type}, timeout: ${timeout}ms)`);
    
    return client;
  }
  
  /**
   * Get Anthropic client for specific use case
   */
  getAnthropic(type: ClientType = 'default'): Anthropic {
    if (!this.config.anthropicKey) {
      throw new Error('Anthropic API key not configured. Call initialize() first.');
    }
    
    // Return cached client if exists
    let client = this.anthropicClients.get(type);
    if (client) {
      return client;
    }
    
    // Create new client with appropriate timeout
    const timeout = this.getTimeout(type);
    client = new Anthropic({
      apiKey: this.config.anthropicKey,
      maxRetries: this.config.maxRetries,
      timeout
    });
    
    this.anthropicClients.set(type, client);
    log.debug(`[ClientPool] 🔧 Created Anthropic client (${type}, timeout: ${timeout}ms)`);
    
    return client;
  }
  
  /**
   * Get timeout for client type
   */
  private getTimeout(type: ClientType): number {
    switch (type) {
      case 'architect':
        return this.config.architectTimeout;
      case 'embedding':
        return this.config.embeddingTimeout;
      case 'discovery':
        return this.config.discoveryTimeout;
      default:
        return this.config.defaultTimeout;
    }
  }
  
  /**
   * Check if pool is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if OpenAI is available
   */
  hasOpenAI(): boolean {
    return !!this.config.openaiKey;
  }
  
  /**
   * Check if Anthropic is available
   */
  hasAnthropic(): boolean {
    return !!this.config.anthropicKey;
  }
  
  /**
   * Get pool statistics
   */
  getStats(): {
    initialized: boolean;
    openaiClients: number;
    anthropicClients: number;
    hasOpenAI: boolean;
    hasAnthropic: boolean;
  } {
    return {
      initialized: this.initialized,
      openaiClients: this.openaiClients.size,
      anthropicClients: this.anthropicClients.size,
      hasOpenAI: !!this.config.openaiKey,
      hasAnthropic: !!this.config.anthropicKey
    };
  }
  
  /**
   * Reset pool (for testing)
   */
  static reset(): void {
    if (APIClientPool.instance) {
      APIClientPool.instance.openaiClients.clear();
      APIClientPool.instance.anthropicClients.clear();
      APIClientPool.instance.initialized = false;
    }
    APIClientPool.instance = null;
  }
}

// Export singleton getter
export const getClientPool = (): APIClientPool => APIClientPool.getInstance();

// Export convenience functions
export const getOpenAI = (type: ClientType = 'default'): OpenAI => {
  return getClientPool().getOpenAI(type);
};

export const getAnthropic = (type: ClientType = 'default'): Anthropic => {
  return getClientPool().getAnthropic(type);
};

export const initializeClientPool = (config: ClientPoolConfig): void => {
  getClientPool().initialize(config);
};

// Export class for advanced usage
export { APIClientPool };
