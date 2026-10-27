/**
 * M7 Hive - Zod Schemas for Agent Responses
 * 
 * Schemas for validating and normalizing LLM responses
 * with sensible defaults for missing fields.
 */

import { z } from 'zod';

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * Risk item schema
 */
export const RiskSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    description: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    mitigation: z.string().optional()
  })
]).transform(val => typeof val === 'string' ? val : val.description);

/**
 * Alternative solution schema
 */
export const AlternativeSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    description: z.string().optional(),
    pros: z.array(z.string()).optional(),
    cons: z.array(z.string()).optional()
  })
]).transform(val => typeof val === 'string' ? val : `${val.name}: ${val.description || ''}`);

// ============================================================================
// AGENT PROPOSAL SCHEMA
// ============================================================================

/**
 * Standard agent proposal schema
 * Used by apiManager, hiveOrchestrator, etc.
 */
export const AgentProposalSchema = z.object({
  // Main content
  proposal: z.string().default(''),
  reasoning: z.string().default(''),
  
  // Confidence score (0-1)
  confidence: z.union([
    z.number().min(0).max(1),
    z.string().transform(s => parseFloat(s) || 0.5)
  ]).default(0.5),
  
  // Implementation details
  implementation_steps: z.array(z.string()).default([]),
  implementationSteps: z.array(z.string()).optional(), // Alternative key
  
  // Requirements
  requirements: z.array(z.string()).default([]),
  
  // Risks
  risks: z.array(RiskSchema).default([]),
  
  // Alternatives
  alternatives: z.array(AlternativeSchema).default([]),
  
  // Time estimate
  estimated_time: z.string().optional(),
  estimatedTime: z.string().optional(),
  
  // Allow extra fields
}).passthrough().transform(data => ({
  proposal: data.proposal,
  reasoning: data.reasoning,
  confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
  implementation_steps: data.implementation_steps.length > 0 
    ? data.implementation_steps 
    : (data.implementationSteps || []),
  requirements: data.requirements,
  risks: data.risks,
  alternatives: data.alternatives,
  estimated_time: data.estimated_time || data.estimatedTime || 'unknown'
}));

export type AgentProposal = z.infer<typeof AgentProposalSchema>;

// ============================================================================
// DYNAMIC AGENT SCHEMA
// ============================================================================

/**
 * Dynamic agent definition (from HiveArchitect)
 */
export const DynamicAgentSchema = z.object({
  role: z.string(),
  expertise: z.string().default(''),
  systemPrompt: z.string().optional(),
  priority: z.number().min(1).max(10).default(5),
  estimatedTokens: z.number().optional(),
  capabilities: z.array(z.string()).optional()
}).passthrough();

export type DynamicAgent = z.infer<typeof DynamicAgentSchema>;

/**
 * Dynamic team configuration
 */
export const DynamicTeamSchema = z.object({
  agents: z.array(DynamicAgentSchema).min(1),
  executionMode: z.enum(['parallel', 'sequential', 'debate']).default('parallel'),
  context: z.string().optional(),
  reasoning: z.string().optional()
}).passthrough();

export type DynamicTeam = z.infer<typeof DynamicTeamSchema>;

// ============================================================================
// CRITIQUE SCHEMA (for debates)
// ============================================================================

export const CritiqueSchema = z.object({
  targetAgentId: z.string(),
  strengths: z.array(z.union([
    z.string(),
    z.object({
      point: z.string(),
      severity: z.enum(['minor', 'moderate', 'major']).optional(),
      evidence: z.string().optional()
    })
  ])).default([]),
  weaknesses: z.array(z.union([
    z.string(),
    z.object({
      point: z.string(),
      severity: z.enum(['minor', 'moderate', 'major']).optional(),
      evidence: z.string().optional()
    })
  ])).default([]),
  suggestions: z.array(z.string()).default([]),
  riskConcerns: z.array(z.string()).default([]),
  overallScore: z.number().min(1).max(10).default(5)
}).passthrough();

export type Critique = z.infer<typeof CritiqueSchema>;

// ============================================================================
// VOTE SCHEMA (for debates)
// ============================================================================

export const VoteSchema = z.object({
  votedFor: z.string(),
  reasoning: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
  rankings: z.array(z.object({
    agentId: z.string(),
    rank: z.number(),
    score: z.number().optional()
  })).optional()
}).passthrough();

export type Vote = z.infer<typeof VoteSchema>;

// ============================================================================
// TASK DECOMPOSITION SCHEMA
// ============================================================================

export const SubtaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  dependencies: z.array(z.string()).default([]),
  priority: z.number().default(5),
  estimatedTime: z.string().optional(),
  requiredExpertise: z.array(z.string()).default([])
}).passthrough();

export const TaskDecompositionSchema = z.object({
  rootTask: z.string(),
  subtasks: z.array(SubtaskSchema).default([]),
  executionOrder: z.array(z.string()).optional(),
  totalEstimate: z.string().optional()
}).passthrough();

export type TaskDecomposition = z.infer<typeof TaskDecompositionSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Safely validate data against a schema
 * Returns normalized data with defaults applied
 */
export function validateWithDefaults<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { valid: boolean; data: T | null; errors: string[]; defaultsApplied: string[] } {
  try {
    const result = schema.safeParse(data);
    
    if (result.success) {
      // Track which fields were defaulted
      const defaultsApplied: string[] = [];
      const input = data as Record<string, unknown>;
      const output = result.data as Record<string, unknown>;
      
      for (const [key, value] of Object.entries(output)) {
        if (!(key in input) || input[key] === undefined) {
          defaultsApplied.push(key);
        }
      }
      
      return {
        valid: true,
        data: result.data,
        errors: [],
        defaultsApplied
      };
    }
    
    return {
      valid: false,
      data: null,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      defaultsApplied: []
    };
  } catch (error) {
    return {
      valid: false,
      data: null,
      errors: [(error as Error).message],
      defaultsApplied: []
    };
  }
}

/**
 * Get schema by name
 */
export function getSchema(name: string): z.ZodSchema | null {
  const schemas: Record<string, z.ZodSchema> = {
    'AgentProposal': AgentProposalSchema,
    'DynamicAgent': DynamicAgentSchema,
    'DynamicTeam': DynamicTeamSchema,
    'Critique': CritiqueSchema,
    'Vote': VoteSchema,
    'TaskDecomposition': TaskDecompositionSchema
  };
  
  return schemas[name] || null;
}
