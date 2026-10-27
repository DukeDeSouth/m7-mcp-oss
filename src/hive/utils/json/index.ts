/**
 * M7 Hive - Robust JSON Parser
 * 
 * Unified API for parsing LLM responses with:
 * 1. Extraction from markdown/mixed content
 * 2. Repair of common JSON issues
 * 3. Truncation recovery
 * 4. Schema validation with defaults
 */

import { z } from 'zod';
import { extractJson, extractAllJson } from './extractor.js';
import { repairJson, mightNeedRepair } from './repairer.js';
import { recoverTruncatedJson, aggressiveRecovery, analyzeTruncation } from './recovery.js';
import { validateWithDefaults, AgentProposalSchema } from './schemas.js';
import { 
  RobustParseResult, 
  RobustParseConfig, 
  DEFAULT_PARSE_CONFIG,
  ExtractionSource
} from './types.js';

// Re-export types and schemas
export * from './types.js';
export * from './schemas.js';
export { extractJson, extractAllJson } from './extractor.js';
export { repairJson, mightNeedRepair } from './repairer.js';
export { recoverTruncatedJson, aggressiveRecovery, analyzeTruncation } from './recovery.js';

// Local type for parsed agent proposals
export interface AgentProposal {
  proposal: string;
  reasoning: string;
  confidence: number;
  implementation_steps: string[];
  requirements: string[];
  risks: string[];
  alternatives: string[];
  estimated_time: string;
}

// ============================================================================
// MAIN PARSING FUNCTION
// ============================================================================

/**
 * Robust JSON parsing with extraction, repair, recovery, and validation
 * 
 * @param content - Raw content from LLM (may contain markdown, prose, etc.)
 * @param schema - Optional Zod schema for validation
 * @param config - Optional configuration
 * @returns Parsed result with metadata
 * 
 * @example
 * // Basic usage
 * const result = await robustParse(llmResponse);
 * if (result.success) {
 *   console.log(result.data);
 * }
 * 
 * @example
 * // With schema validation
 * const result = await robustParse(llmResponse, AgentProposalSchema);
 * if (result.success) {
 *   const proposal = result.data; // Typed as AgentProposal
 * }
 */
export function robustParse<T = unknown>(
  content: string,
  schema?: z.ZodSchema<T>,
  config: Partial<RobustParseConfig> = {}
): RobustParseResult<T> {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_PARSE_CONFIG, ...config };
  
  // Initialize result
  const result: RobustParseResult<T> = {
    success: false,
    data: null,
    raw: content,
    extraction: {
      source: 'none' as ExtractionSource,
      warnings: []
    },
    repair: {
      wasRepaired: false,
      changes: []
    },
    recovery: {
      wasTruncated: false,
      recoveryAttempted: false
    },
    validation: {
      errors: [],
      defaultsApplied: []
    },
    confidence: 0,
    processingTime: 0
  };
  
  try {
    // Check content length
    if (!content || content.length === 0) {
      result.error = 'Empty content';
      result.processingTime = Date.now() - startTime;
      return result;
    }
    
    if (content.length > cfg.maxContentLength) {
      result.error = `Content too long (${content.length} > ${cfg.maxContentLength})`;
      result.processingTime = Date.now() - startTime;
      return result;
    }
    
    // Step 1: Extract JSON from content
    const extraction = cfg.extractFromMarkdown 
      ? extractJson(content) 
      : { found: content.trim().startsWith('{') || content.trim().startsWith('['), json: content, source: 'raw' as ExtractionSource, warnings: [] };
    
    result.extraction = {
      source: extraction.source,
      warnings: extraction.warnings
    };
    
    if (!extraction.found || !extraction.json) {
      result.error = 'No JSON found in content';
      result.processingTime = Date.now() - startTime;
      return result;
    }
    
    let json = extraction.json;
    
    // Step 2: Repair common issues
    if (cfg.enableRepair && mightNeedRepair(json)) {
      const repair = repairJson(json);
      json = repair.repaired;
      result.repair = {
        wasRepaired: repair.wasRepaired,
        changes: repair.changes
      };
    }
    
    // Step 3: Try to parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (parseError) {
      // Step 3b: Try truncation recovery
      if (cfg.enableRecovery) {
        const recovery = aggressiveRecovery(json);
        result.recovery = {
          wasTruncated: recovery.analysis.isTruncated,
          recoveryAttempted: recovery.recoveryAttempted
        };
        
        if (recovery.structureIntact) {
          try {
            parsed = JSON.parse(recovery.recovered);
            json = recovery.recovered;
          } catch {
            result.error = `JSON parse failed after recovery: ${(parseError as Error).message}`;
            result.processingTime = Date.now() - startTime;
            return result;
          }
        } else {
          result.error = `JSON parse failed: ${(parseError as Error).message}`;
          result.processingTime = Date.now() - startTime;
          return result;
        }
      } else {
        result.error = `JSON parse failed: ${(parseError as Error).message}`;
        result.processingTime = Date.now() - startTime;
        return result;
      }
    }
    
    // Step 4: Schema validation (if provided)
    if (schema) {
      const validation = validateWithDefaults(schema, parsed);
      result.validation = {
        errors: validation.errors.map(e => ({ path: [], message: e })),
        defaultsApplied: validation.defaultsApplied
      };
      
      if (!validation.valid) {
        result.error = `Schema validation failed: ${validation.errors.join(', ')}`;
        result.processingTime = Date.now() - startTime;
        return result;
      }
      
      result.data = validation.data;
    } else {
      result.data = parsed as T;
    }
    
    // Calculate confidence
    let confidence = 1.0;
    
    // Penalty for repairs
    if (result.repair.wasRepaired) {
      confidence -= result.repair.changes.length * 0.02;
    }
    
    // Penalty for recovery
    if (result.recovery.recoveryAttempted) {
      confidence -= 0.1;
    }
    
    // Penalty for defaults applied
    confidence -= result.validation.defaultsApplied.length * 0.03;
    
    // Bonus for markdown_json source (explicit JSON block)
    if (result.extraction.source === 'markdown_json') {
      confidence += 0.05;
    }
    
    result.confidence = Math.max(cfg.minConfidence, Math.min(1.0, confidence));
    result.success = true;
    result.processingTime = Date.now() - startTime;
    
    return result;
    
  } catch (error) {
    result.error = `Unexpected error: ${(error as Error).message}`;
    result.processingTime = Date.now() - startTime;
    return result;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Parse content expecting an AgentProposal
 * Uses the standard AgentProposalSchema
 */
export function parseAgentProposal(content: string): RobustParseResult<AgentProposal> {
  // Parse without strict schema to avoid Zod transform type issues
  const result = robustParse(content);
  
  if (result.success && result.data && typeof result.data === 'object') {
    const raw = result.data as Record<string, any>;
    const data: AgentProposal = {
      proposal: raw.proposal || '',
      reasoning: raw.reasoning || '',
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
      implementation_steps: raw.implementation_steps || raw.implementationSteps || [],
      requirements: raw.requirements || [],
      risks: raw.risks || [],
      alternatives: raw.alternatives || [],
      estimated_time: raw.estimated_time || raw.estimatedTime || 'unknown'
    };
    
    return {
      ...result,
      data
    };
  }
  
  return {
    ...result,
    data: null
  };
}

/**
 * Quick parse without schema validation
 * Useful for exploratory parsing
 */
export function quickParse(content: string): RobustParseResult {
  return robustParse(content, undefined, {
    enableRepair: true,
    enableRecovery: true
  });
}

/**
 * Strict parse with minimal recovery
 * Useful when you need high confidence
 */
export function strictParse<T>(content: string, schema: z.ZodSchema<T>): RobustParseResult<T> {
  return robustParse(content, schema, {
    enableRepair: false,
    enableRecovery: false,
    minConfidence: 0.8
  });
}

/**
 * Parse all JSON objects in content
 * Useful for multi-object responses
 */
export function parseAllJson(content: string): RobustParseResult[] {
  const extractions = extractAllJson(content);
  return extractions.map(ext => {
    if (!ext.found || !ext.json) {
      return {
        success: false,
        data: null,
        raw: content,
        extraction: { source: ext.source, warnings: ext.warnings },
        repair: { wasRepaired: false, changes: [] },
        recovery: { wasTruncated: false, recoveryAttempted: false },
        validation: { errors: [], defaultsApplied: [] },
        confidence: 0,
        error: 'Extraction failed',
        processingTime: 0
      };
    }
    return robustParse(ext.json);
  });
}

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

/**
 * Legacy parseAgentResponse compatible function
 * Returns data in the old format for backward compatibility
 * Generic T allows AgentType to flow through from caller
 */
export function parseLegacyAgentResponse<T extends string>(
  agentId: T,
  content: string
): {
  agentId: T;
  proposal: string;
  reasoning: string;
  confidence: number;
  implementation_steps: string[];
  requirements: string[];
  risks: string[];
  alternatives: string[];
  estimated_time?: string;
} {
  const result = parseAgentProposal(content);
  
  if (result.success && result.data) {
    return {
      agentId,
      proposal: result.data.proposal,
      reasoning: result.data.reasoning,
      confidence: result.confidence, // Use pipeline confidence
      implementation_steps: result.data.implementation_steps,
      requirements: result.data.requirements,
      risks: result.data.risks,
      alternatives: result.data.alternatives,
      estimated_time: result.data.estimated_time
    };
  }
  
  // Fallback for failed parsing
  return {
    agentId,
    proposal: content,
    reasoning: `Raw response (parsing failed: ${result.error})`,
    confidence: 0.3,
    implementation_steps: [],
    requirements: [],
    risks: ['Response parsing failed'],
    alternatives: []
  };
}
