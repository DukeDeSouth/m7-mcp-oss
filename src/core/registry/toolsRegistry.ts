/**
 * M7 Tools Registry
 * 
 * Official registry of all M7 MCP tools.
 * Use this as the source of truth for tool count and names.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

export interface ToolDefinition {
  id: number;
  name: string;
  description: string;
  category: ToolCategory;
  version: string;
  required: boolean;  // false = optional (depends on env vars)
}

export type ToolCategory = 
  | 'core'
  | 'unified'
  | 'critical'
  | 'tsi'
  | 'hive'
  | 'memory'
  | 'analysis'
  | 'devops'
  | 'debug';

/**
 * Official M7 Tools Registry
 * 
 * Total: 30 tools (v5.0 Phase 1)
 */
export const TOOLS_REGISTRY: ToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════════
  // CORE TOOLS (1-11)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 1,
    name: 'mcp_m7_analyze_task',
    description: 'Main entry point for M7 methodology - analyzes tasks and routes to appropriate workflow',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  {
    id: 2,
    name: 'mcp_m7_memory',
    description: 'Unified Memory System - 5-level hierarchy (L0-L4) with FogOfWar, cascade search, auto-promotion',
    category: 'unified',
    version: '5.0.0',
    required: true
  },
  {
    id: 3,
    name: 'mcp_m7_session',
    description: 'Session management - start, track, complete M7 sessions',
    category: 'unified',
    version: '1.0.0',
    required: true
  },
  {
    id: 4,
    name: 'mcp_m7_validate',
    description: 'Validation operations - check code, contracts, safety',
    category: 'unified',
    version: '1.0.0',
    required: true
  },
  {
    id: 5,
    name: 'mcp_m7_scope',
    description: 'Scope guard - detect and manage scope creep',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  {
    id: 6,
    name: 'mcp_m7_init_project',
    description: 'Initialize M7 for a new project',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  {
    id: 7,
    name: 'mcp_m7_check_errors',
    description: 'Check and analyze errors from journal',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  // DELETED v5.0: mcp_m7_create_structure (use mcp_m7_cycle)
  // DELETED v5.0: mcp_m7_dashboard (unused, complex)
  // DELETED v5.0: mcp_m7_navigate (use mcp_m7_session)
  {
    id: 11,
    name: 'mcp_m7_schema',
    description: 'Project schema management',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // PROJECT INDEX (12)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 12,
    name: 'mcp_m7_project_index',
    description: 'Project index generation and management',
    category: 'core',
    version: '2.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // TSI SYSTEM (13-15)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 13,
    name: 'mcp_m7_check_tech_stack',
    description: 'TSI: Check technology stack compatibility',
    category: 'tsi',
    version: '1.0.0',
    required: true
  },
  {
    id: 14,
    name: 'mcp_m7_get_patterns',
    description: 'TSI: Get recommended patterns for tech stack',
    category: 'tsi',
    version: '1.0.0',
    required: true
  },
  {
    id: 15,
    name: 'mcp_m7_validate_implementation',
    description: 'TSI: Validate implementation against patterns',
    category: 'tsi',
    version: '1.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // CRITICAL v2.0 TOOLS (16-20)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 16,
    name: 'mcp_m7_console',
    description: 'Console log analysis and debugging',
    category: 'critical',
    version: '2.0.0',
    required: true
  },
  {
    id: 17,
    name: 'mcp_m7_contracts',
    description: 'API contracts management and validation',
    category: 'critical',
    version: '2.0.0',
    required: true
  },
  // DELETED v5.0: mcp_m7_versioning (use mcp_m7_devops)
  // DELETED v5.0: mcp_m7_locks (Cursor IDE manages file locks)
  {
    id: 20,
    name: 'mcp_m7_impact',
    description: 'Impact analysis for code changes',
    category: 'critical',
    version: '2.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // DEBUG & HIVE (21-23)
  // ═══════════════════════════════════════════════════════════════
  // DELETED v5.0: mcp_m7_test (debug-only, not needed in production)
  {
    id: 22,
    name: 'mcp_m7_hive_coordinator',
    description: 'Hive multiagent coordinator - expert consultations',
    category: 'hive',
    version: '1.0.0',
    required: true
  },
  {
    id: 23,
    name: 'mcp_m7_knowledge_hub',
    description: 'Knowledge hub - patterns, learnings, best practices',
    category: 'core',
    version: '1.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // v3.0 MEMORY & ANALYSIS (26-33)
  // Note: mcp_m7_persistent_memory (24) and mcp_m7_auto_memory (25) 
  // DELETED in v5.0 - consolidated into mcp_m7_memory (Unified Memory System)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 26,
    name: 'mcp_m7_style_guardian',
    description: 'Code style enforcement and checking',
    category: 'analysis',
    version: '3.0.0',
    required: true
  },
  {
    id: 27,
    name: 'mcp_m7_error_database',
    description: 'Error pattern database and matching',
    category: 'analysis',
    version: '3.0.0',
    required: true
  },
  {
    id: 28,
    name: 'mcp_m7_knowledge_graph',
    description: 'Code dependency graph and impact analysis',
    category: 'analysis',
    version: '3.0.0',
    required: true
  },
  {
    id: 29,
    name: 'mcp_m7_arch_advisor',
    description: 'Architectural advisor and recommendations',
    category: 'analysis',
    version: '3.0.0',
    required: true
  },
  {
    id: 30,
    name: 'mcp_m7_cross_session',
    description: 'Cross-session learning and pattern transfer',
    category: 'memory',
    version: '3.0.0',
    required: true
  },
  {
    id: 31,
    name: 'mcp_m7_visualizer',
    description: 'Context visualizer - Mermaid diagrams',
    category: 'analysis',
    version: '3.0.0',
    required: true
  },
  {
    id: 33,
    name: 'mcp_m7_telemetry',
    description: 'Code telemetry collection and analysis',
    category: 'analysis',
    version: '3.1.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // v4.0 TASK MANAGEMENT & DEVOPS (34-37)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 34,
    name: 'mcp_m7_task_transfer',
    description: 'Task transfer and escalation management',
    category: 'core',
    version: '4.0.0',
    required: true
  },
  {
    id: 35,
    name: 'mcp_m7_task_graph',
    description: 'Task hierarchy graph and visualization',
    category: 'core',
    version: '4.0.0',
    required: true
  },
  {
    id: 36,
    name: 'mcp_m7_warmup',
    description: 'Project warmup - load context for new sessions',
    category: 'core',
    version: '4.0.0',
    required: true
  },
  {
    id: 37,
    name: 'mcp_m7_devops',
    description: 'DevOps registry - environments, deploy validation, history',
    category: 'devops',
    version: '4.0.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // v4.1 CYCLE ORCHESTRATOR (38)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 38,
    name: 'mcp_m7_cycle',
    description: 'M7 Cycle Orchestrator - explicit 7-phase workflow guidance',
    category: 'core',
    version: '4.1.0',
    required: true
  },
  
  // ═══════════════════════════════════════════════════════════════
  // v3.10.2 PHASE 3: DOCTOR (39)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 39,
    name: 'mcp_m7_doctor',
    description: 'M7 Doctor - health check and auto-repair for .m7/ directory',
    category: 'debug',
    version: '1.0.0',
    required: true
  }
];

/**
 * Get total tool count
 */
export function getToolCount(): number {
  return TOOLS_REGISTRY.length;
}

/**
 * Get required tool count (always available)
 */
export function getRequiredToolCount(): number {
  return TOOLS_REGISTRY.filter(t => t.required).length;
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOLS_REGISTRY.filter(t => t.category === category);
}

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS_REGISTRY.find(t => t.name === name);
}

/**
 * Get tools by version
 */
export function getToolsByVersion(version: string): ToolDefinition[] {
  return TOOLS_REGISTRY.filter(t => t.version.startsWith(version));
}

/**
 * Generate registry summary
 */
export function getRegistrySummary(): {
  total: number;
  required: number;
  optional: number;
  byCategory: Record<string, number>;
  byVersion: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const byVersion: Record<string, number> = {};
  
  for (const tool of TOOLS_REGISTRY) {
    byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
    const majorVersion = tool.version.split('.')[0] + '.x';
    byVersion[majorVersion] = (byVersion[majorVersion] || 0) + 1;
  }
  
  return {
    total: TOOLS_REGISTRY.length,
    required: TOOLS_REGISTRY.filter(t => t.required).length,
    optional: TOOLS_REGISTRY.filter(t => !t.required).length,
    byCategory,
    byVersion
  };
}

// Export constants
// v5.0 Phase 2: Reduced from 30 to 28 after consolidating memory tools
// Deleted: mcp_m7_persistent_memory (24), mcp_m7_auto_memory (25) 
// → consolidated into mcp_m7_memory (Unified Memory System with 5-level hierarchy)
// v3.10.2 Phase 3: Added mcp_m7_doctor (39)
export const TOTAL_TOOLS = 29;
export const EXPECTED_REQUIRED_TOOLS = 29;  // All required
