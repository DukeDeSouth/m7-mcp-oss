export type AgentType = 'research' | 'implementation' | 'architecture' | 'security' | 'testing' | 'performance' | 'techsafety';

export interface AgentConfig {
  id: AgentType;
  provider: 'openai' | 'anthropic';
  model: string;
  specialization: string;
  strengths: string[];
  cost_tier: 'premium' | 'standard' | 'economy';
}

export interface AgentProposal {
  agentId: AgentType;
  proposal: string;
  reasoning: string;
  confidence: number; // 0-1
  implementation_steps?: string[];
  requirements?: string[];
  risks?: string[];
  alternatives?: string[];
  estimated_cost?: number;
  estimated_time?: string;
}

// TSI types (simplified - avoid circular dependency)
export interface TechPattern {
  id: string;
  name: string;
  technology: string;
  category: string;
  type: 'pattern' | 'antipattern';
  description: string;
  confidence: number;
  riskScore: number;
  tags: string[];
}

export interface AgentContext {
  task: string;
  project_context?: any;
  existing_code?: string;
  constraints?: string[];
  preferences?: string[];
  // Phase 2: TSI Integration
  tsi_enabled?: boolean;
  tsi_patterns?: TechPattern[];
  // Phase 2: Context7 Integration
  context7_enabled?: boolean;
  context7_docs?: string;
}

export interface AgentResponse {
  success: boolean;
  proposal?: AgentProposal;
  error?: string;
  tokens_used?: number;
  cost_estimate?: number;
}
