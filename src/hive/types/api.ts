import { AgentType } from './agent.js';

export interface APIConfig {
  openai: string;
  anthropic: string;
}

export interface APIResponse {
  content: string;
  tokens_used: number;
  model: string;
  cost_estimate: number;
  response_time: number;
}

export interface RequestMetrics {
  agent: AgentType;
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost: number;
  latency: number;
  success: boolean;
  // v3.10: Retry tracking
  retryAttempts?: number;
  retryDelayMs?: number;
}
