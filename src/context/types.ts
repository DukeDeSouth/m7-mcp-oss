/**
 * M7 v3.1 - Context Provider Types
 * 
 * Types for time and model context injection
 */

/**
 * Current context returned by ContextProvider
 */
export interface CurrentContext {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Human-readable formatted time */
  formattedTime: string;
  /** Available AI models from APIs */
  models: AvailableModels;
  /** Pre-built Markdown header for injection */
  header: string;
}

/**
 * Available models from AI providers
 */
export interface AvailableModels {
  openai: ModelInfo[];
  anthropic: ModelInfo[];
  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Model information
 */
export interface ModelInfo {
  /** Model ID (e.g., "gpt-5.2", "claude-opus-4-5") */
  id: string;
  /** Display name */
  name: string;
  /** Creation timestamp (optional) */
  created?: number;
}

/**
 * Context Provider configuration
 */
export interface ContextProviderConfig {
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTtlMs: number;
  /** API timeout in milliseconds (default: 5000) */
  timeout: number;
  /** Fallback models when APIs unavailable */
  fallbackModels: AvailableModels;
  /** Enable context injection */
  enabled: boolean;
}

/**
 * Default fallback models (as of January 2026)
 */
export const DEFAULT_FALLBACK_MODELS: AvailableModels = {
  openai: [
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4o', name: 'GPT-4o' },
  ],
  anthropic: [
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
  ],
  lastUpdated: 'fallback',
};

/**
 * Default configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextProviderConfig = {
  cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  timeout: 5000, // 5 seconds
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  enabled: true,
};

