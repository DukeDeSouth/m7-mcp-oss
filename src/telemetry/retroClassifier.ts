/**
 * Retro-classifier for legacy telemetry events
 * 
 * Problem: ~3,365 events stored as generic 'prompt_completion' 
 * without tool_name, episode_id, or schema_version.
 * 
 * This module analyzes prompt and response content to recover 
 * the original tool_name and reclassify events for training data quality.
 * 
 * @module retroClassifier
 * @since v3.13.0
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';

// ─── Types ───────────────────────────────────────────────────────────────

interface RawEvent {
  type: string;
  timestamp: string;
  session_id?: string;
  episode_id?: string;
  tool_name?: string;
  schema_version?: number;
  prompt?: string;
  completion?: { code?: string; model?: string };
  context?: Record<string, unknown>;
  feedback?: { time_to_accept?: number };
  // investigation fields
  query?: string;
  result_summary?: string;
  duration_ms?: number;
  // hive fields
  task?: string;
  mode?: string;
  agents_count?: number;
  result?: string;
  // error_fix fields
  error_message?: string;
  fix_code?: string;
  [key: string]: unknown;
}

interface ClassifiedEvent extends RawEvent {
  tool_name: string;
  tool_action?: string;
  schema_version: number;
  _retro_classified: true;
  _classification_confidence: number;
  _classification_method: 'prompt_exact' | 'prompt_keyword' | 'response_pattern' | 'combined';
}

interface ClassificationResult {
  tool_name: string;
  tool_action?: string;
  confidence: number;
  method: 'prompt_exact' | 'prompt_keyword' | 'response_pattern' | 'combined';
}

interface RetroClassificationStats {
  total_events: number;
  already_classified: number;
  newly_classified: number;
  still_unknown: number;
  by_tool: Record<string, number>;
  by_method: Record<string, number>;
  by_confidence: { high: number; medium: number; low: number };
}

// ─── Classification Rules ────────────────────────────────────────────────

/**
 * EXACT prompt matches — when the prompt is literally the tool name
 */
const PROMPT_EXACT_MAP: Record<string, { tool: string; action?: string }> = {
  'mark_complete': { tool: 'mcp_m7_session', action: 'mark_complete' },
  'status': { tool: 'mcp_m7_session', action: 'status' },
  'health_check': { tool: 'mcp_m7_session', action: 'health_check' },
  'enforce_compliance': { tool: 'mcp_m7_session', action: 'enforce_compliance' },
  'complete_session': { tool: 'mcp_m7_session', action: 'complete_session' },
  'list_active': { tool: 'mcp_m7_session', action: 'list_active' },
  'get': { tool: 'mcp_m7_task_graph', action: 'get' },
  'list': { tool: 'mcp_m7_task_graph', action: 'list' },
  'recent': { tool: 'mcp_m7_task_graph', action: 'recent' },
  'visualize': { tool: 'mcp_m7_task_graph', action: 'visualize' },
  'links': { tool: 'mcp_m7_task_graph', action: 'links' },
  'subgraph': { tool: 'mcp_m7_task_graph', action: 'subgraph' },
  'generate': { tool: 'mcp_m7_dcce', action: 'generate' },
  'validate': { tool: 'mcp_m7_dcce', action: 'validate' },
  'render': { tool: 'mcp_m7_dcce', action: 'render' },
  'lint': { tool: 'mcp_m7_dcce', action: 'lint' },
  'extract': { tool: 'mcp_m7_dcce', action: 'extract' },
  'check': { tool: 'mcp_m7_check_errors', action: 'check' },
  'store': { tool: 'mcp_m7_memory', action: 'store' },
  'search': { tool: 'mcp_m7_memory', action: 'search' },
  'store_pattern': { tool: 'mcp_m7_memory', action: 'store_pattern' },
  'auto_search': { tool: 'mcp_m7_memory', action: 'auto_search' },
  'search_level': { tool: 'mcp_m7_memory', action: 'search_level' },
  'discover_technical': { tool: 'mcp_m7_memory', action: 'discover_technical' },
  'promote': { tool: 'mcp_m7_memory', action: 'promote' },
  'scan': { tool: 'mcp_m7_project_index', action: 'scan' },
  'warmup': { tool: 'mcp_m7_warmup', action: 'warmup' },
  'record': { tool: 'mcp_m7_warmup', action: 'record' },
  'compliance': { tool: 'mcp_m7_warmup', action: 'compliance' },
  'analyze': { tool: 'mcp_m7_arch_advisor', action: 'analyze' },
  'push': { tool: 'mcp_m7_memory', action: 'push' },
  'pop': { tool: 'mcp_m7_memory', action: 'pop' },
  'stats': { tool: 'mcp_m7_telemetry', action: 'stats' },
  'history': { tool: 'mcp_m7_impact', action: 'history' },
  'init': { tool: 'mcp_m7_knowledge_hub', action: 'init' },
  'set-budget': { tool: 'mcp_m7_scope', action: 'set-budget' },
  'register': { tool: 'mcp_m7_contracts', action: 'register' },
  'find_duplicates': { tool: 'mcp_m7_contracts', action: 'find_duplicates' },
  'suggest_name': { tool: 'mcp_m7_contracts', action: 'suggest_name' },
  'compare': { tool: 'mcp_m7_impact', action: 'compare' },
  'reflect': { tool: 'mcp_m7_impact', action: 'reflect' },
  'patterns': { tool: 'mcp_m7_impact', action: 'patterns' },
  'build': { tool: 'mcp_m7_knowledge_graph', action: 'build' },
  'metrics': { tool: 'mcp_m7_knowledge_graph', action: 'metrics' },
  'cycles': { tool: 'mcp_m7_knowledge_graph', action: 'cycles' },
  'orphans': { tool: 'mcp_m7_knowledge_graph', action: 'orphans' },
  'diagram': { tool: 'mcp_m7_knowledge_graph', action: 'diagram' },
  'critical': { tool: 'mcp_m7_knowledge_graph', action: 'critical' },
  'sync': { tool: 'mcp_m7_knowledge_hub', action: 'sync' },
  'enable': { tool: 'mcp_m7_telemetry', action: 'enable' },
  'disable': { tool: 'mcp_m7_telemetry', action: 'disable' },
  'flush': { tool: 'mcp_m7_telemetry', action: 'flush' },
  'start': { tool: 'mcp_m7_console', action: 'start' },
  'stop': { tool: 'mcp_m7_console', action: 'stop' },
  'get_errors': { tool: 'mcp_m7_console', action: 'get_errors' },
  'clear': { tool: 'mcp_m7_console', action: 'clear' },
  'transfer': { tool: 'mcp_m7_task_transfer', action: 'transfer' },
  'check_scope': { tool: 'mcp_m7_task_transfer', action: 'check_scope' },
  'fix': { tool: 'mcp_m7_doctor', action: 'fix' },
  'report': { tool: 'mcp_m7_doctor', action: 'report' },
  'extend': { tool: 'mcp_m7_scope', action: 'extend' },
  'rollback': { tool: 'mcp_m7_scope', action: 'rollback' },
  // Error database actions
  'capture': { tool: 'mcp_m7_error_database', action: 'capture' },
  'correct': { tool: 'mcp_m7_error_database', action: 'correct' },
  'report_fp': { tool: 'mcp_m7_error_database', action: 'report_fp' },
  // Schema actions
  'view': { tool: 'mcp_m7_schema', action: 'view' },
  'update_project': { tool: 'mcp_m7_memory', action: 'update_project' },
  // Cross-session
  'get_context': { tool: 'mcp_m7_cross_session', action: 'get_context' },
  'format_prompt': { tool: 'mcp_m7_cross_session', action: 'format_prompt' },
  // Warmup
  'akstis': { tool: 'mcp_m7_warmup', action: 'akstis' },
  // Arch advisor
  'score': { tool: 'mcp_m7_arch_advisor', action: 'score' },
  'critical_issues': { tool: 'mcp_m7_arch_advisor', action: 'critical_issues' },
  'suggest_refactoring': { tool: 'mcp_m7_arch_advisor', action: 'suggest_refactoring' },
  'generate_c4': { tool: 'mcp_m7_arch_advisor', action: 'generate_c4' },
  'top_suggestions': { tool: 'mcp_m7_arch_advisor', action: 'top_suggestions' },
  // Style guardian
  'learn': { tool: 'mcp_m7_style_guardian', action: 'learn' },
  'profile': { tool: 'mcp_m7_style_guardian', action: 'profile' },
  // DevOps
  'environments': { tool: 'mcp_m7_devops', action: 'environments' },
  'deploy': { tool: 'mcp_m7_devops', action: 'deploy' },
  'wizard': { tool: 'mcp_m7_devops', action: 'wizard' },
  // Validate
  'baseline_audit': { tool: 'mcp_m7_validate', action: 'baseline_audit' },
  'quality_check': { tool: 'mcp_m7_validate', action: 'quality_check' },
  'visual_validate': { tool: 'mcp_m7_validate', action: 'visual_validate' },
  'check_dependencies': { tool: 'mcp_m7_validate', action: 'check_dependencies' },
  'track_metrics': { tool: 'mcp_m7_validate', action: 'track_metrics' },
  // Gates/locks
  'lock': { tool: 'mcp_m7_session', action: 'lock' },
  'where_am_i': { tool: 'mcp_m7_session', action: 'where_am_i' },
  'show_roadmap': { tool: 'mcp_m7_session', action: 'show_roadmap' },
};

/**
 * Prompt starts with tool name (e.g., "mcp_m7_cycle" → cycle tool)
 */
const PROMPT_PREFIX_MAP: Record<string, string> = {
  'mcp_m7_cycle': 'mcp_m7_cycle',
  'mcp_m7_create_structure': 'mcp_m7_create_structure',
  'mcp_m7_hive_coordinator': 'mcp_m7_hive_coordinator',
  'mcp_m7_init_project': 'mcp_m7_init_project',
  'mcp_m7_get_patterns': 'mcp_m7_get_patterns',
  'mcp_m7_check_tech_stack': 'mcp_m7_check_tech_stack',
  'mcp_m7_validate_implementation': 'mcp_m7_validate_implementation',
  'mcp_m7_analyze_task': 'mcp_m7_analyze_task',
  'mcp_m7_memory': 'mcp_m7_memory',
  'mcp_m7_session': 'mcp_m7_session',
  'mcp_m7_validate': 'mcp_m7_validate',
  'mcp_m7_scope': 'mcp_m7_scope',
  'mcp_m7_schema': 'mcp_m7_schema',
  'mcp_m7_project_index': 'mcp_m7_project_index',
  'mcp_m7_knowledge_hub': 'mcp_m7_knowledge_hub',
  'mcp_m7_knowledge_graph': 'mcp_m7_knowledge_graph',
  'mcp_m7_style_guardian': 'mcp_m7_style_guardian',
  'mcp_m7_error_database': 'mcp_m7_error_database',
  'mcp_m7_cross_session': 'mcp_m7_cross_session',
  'mcp_m7_arch_advisor': 'mcp_m7_arch_advisor',
  'mcp_m7_console': 'mcp_m7_console',
  'mcp_m7_contracts': 'mcp_m7_contracts',
  'mcp_m7_impact': 'mcp_m7_impact',
  'mcp_m7_devops': 'mcp_m7_devops',
  'mcp_m7_telemetry': 'mcp_m7_telemetry',
  'mcp_m7_warmup': 'mcp_m7_warmup',
  'mcp_m7_dcce': 'mcp_m7_dcce',
  'mcp_m7_task_graph': 'mcp_m7_task_graph',
  'mcp_m7_task_transfer': 'mcp_m7_task_transfer',
  'mcp_m7_doctor': 'mcp_m7_doctor',
  'mcp_m7_mesh': 'mcp_m7_mesh',
  'mcp_m7_visualizer': 'mcp_m7_visualizer',
};

/**
 * Response pattern matches — check the completion text for tool signatures
 */
interface ResponseRule {
  pattern: string | RegExp;
  tool: string;
  action?: string;
  confidence: number;
}

const RESPONSE_RULES: ResponseRule[] = [
  // Session tool
  { pattern: 'M7 Session: MARK_COMPLETE', tool: 'mcp_m7_session', action: 'mark_complete', confidence: 0.95 },
  { pattern: 'M7 Session Status', tool: 'mcp_m7_session', action: 'status', confidence: 0.95 },
  { pattern: 'Session Health Check', tool: 'mcp_m7_session', action: 'health_check', confidence: 0.95 },
  { pattern: 'Compliance Check', tool: 'mcp_m7_session', action: 'enforce_compliance', confidence: 0.90 },
  { pattern: 'Active M7 Sessions', tool: 'mcp_m7_session', action: 'list_active', confidence: 0.90 },
  
  // Analyze task
  { pattern: 'M7 Task Analysis Complete', tool: 'mcp_m7_analyze_task', confidence: 0.95 },
  { pattern: /System Status.*All systems operational/s, tool: 'mcp_m7_analyze_task', confidence: 0.85 },
  
  // DCCE
  { pattern: 'DCCE Envelope', tool: 'mcp_m7_dcce', confidence: 0.95 },
  { pattern: 'Dual-Channel', tool: 'mcp_m7_dcce', confidence: 0.90 },
  
  // Cycle
  { pattern: 'M7 CYCLE:', tool: 'mcp_m7_cycle', confidence: 0.95 },
  { pattern: 'CURRENT PHASE:', tool: 'mcp_m7_cycle', confidence: 0.90 },
  
  // Create structure
  { pattern: 'M7 Structure Created', tool: 'mcp_m7_create_structure', confidence: 0.95 },
  { pattern: 'Files Created:', tool: 'mcp_m7_create_structure', confidence: 0.80 },
  
  // Hive
  { pattern: 'M7 Hive', tool: 'mcp_m7_hive_coordinator', confidence: 0.95 },
  { pattern: /Hive v\d/s, tool: 'mcp_m7_hive_coordinator', confidence: 0.90 },
  
  // Memory
  { pattern: 'M7 Unified Memory', tool: 'mcp_m7_memory', confidence: 0.95 },
  { pattern: /Memory.*L[0-4]/s, tool: 'mcp_m7_memory', confidence: 0.80 },
  
  // Knowledge Graph
  { pattern: 'Knowledge Graph', tool: 'mcp_m7_knowledge_graph', confidence: 0.85 },
  
  // Style Guardian
  { pattern: 'Style Guardian', tool: 'mcp_m7_style_guardian', confidence: 0.90 },
  { pattern: 'Style Profile', tool: 'mcp_m7_style_guardian', confidence: 0.85 },
  
  // Error Database
  { pattern: 'Error Pattern', tool: 'mcp_m7_error_database', confidence: 0.85 },
  { pattern: 'Error Journal', tool: 'mcp_m7_check_errors', confidence: 0.85 },
  
  // Cross-Session
  { pattern: 'Cross-Session', tool: 'mcp_m7_cross_session', confidence: 0.90 },
  
  // Architecture Advisor
  { pattern: 'Architecture Advisor', tool: 'mcp_m7_arch_advisor', confidence: 0.90 },
  { pattern: 'Arch Score', tool: 'mcp_m7_arch_advisor', confidence: 0.85 },
  
  // Project Index
  { pattern: 'Project Index', tool: 'mcp_m7_project_index', confidence: 0.85 },
  { pattern: 'PROJECT_INDEX.md', tool: 'mcp_m7_project_index', confidence: 0.90 },
  
  // Knowledge Hub
  { pattern: 'Knowledge Hub', tool: 'mcp_m7_knowledge_hub', confidence: 0.85 },
  
  // DevOps
  { pattern: 'DevOps Registry', tool: 'mcp_m7_devops', confidence: 0.90 },
  { pattern: 'Deploy', tool: 'mcp_m7_devops', confidence: 0.60 },
  
  // Impact
  { pattern: 'Impact Analyz', tool: 'mcp_m7_impact', confidence: 0.85 },
  { pattern: 'Code Impact', tool: 'mcp_m7_impact', confidence: 0.85 },
  
  // Console
  { pattern: 'Console Monitor', tool: 'mcp_m7_console', confidence: 0.90 },
  
  // Contracts
  { pattern: 'API Contract', tool: 'mcp_m7_contracts', confidence: 0.90 },
  
  // Warmup
  { pattern: 'Warmup Complete', tool: 'mcp_m7_warmup', confidence: 0.95 },
  { pattern: 'M7 Warmup', tool: 'mcp_m7_warmup', confidence: 0.90 },
  
  // Telemetry
  { pattern: 'Telemetry Status', tool: 'mcp_m7_telemetry', confidence: 0.90 },
  { pattern: 'Telemetry Stats', tool: 'mcp_m7_telemetry', confidence: 0.90 },
  
  // TSI tools
  { pattern: 'Tech Safety', tool: 'mcp_m7_check_tech_stack', confidence: 0.85 },
  { pattern: 'Tech Patterns', tool: 'mcp_m7_get_patterns', confidence: 0.85 },
  { pattern: 'Validation Results', tool: 'mcp_m7_validate_implementation', confidence: 0.80 },
  
  // Init Project
  { pattern: 'M7 Ecosystem Initialized', tool: 'mcp_m7_init_project', confidence: 0.95 },
  { pattern: 'Directory Not Empty', tool: 'mcp_m7_init_project', confidence: 0.90 },
  
  // Scope
  { pattern: 'Scope Status', tool: 'mcp_m7_scope', action: 'status', confidence: 0.90 },
  { pattern: 'Scope Budget', tool: 'mcp_m7_scope', action: 'set-budget', confidence: 0.90 },
  
  // Validate
  { pattern: 'Baseline Audit', tool: 'mcp_m7_validate', action: 'baseline_audit', confidence: 0.90 },
  { pattern: 'Quality Check', tool: 'mcp_m7_validate', action: 'quality_check', confidence: 0.85 },
  
  // Schema
  { pattern: 'Project Schema', tool: 'mcp_m7_schema', confidence: 0.85 },
  
  // Task Graph
  { pattern: 'Детали задачи', tool: 'mcp_m7_task_graph', action: 'get', confidence: 0.85 },
  { pattern: 'Task Graph', tool: 'mcp_m7_task_graph', confidence: 0.85 },
  { pattern: 'Dependency Graph', tool: 'mcp_m7_task_graph', confidence: 0.80 },
  
  // Doctor
  { pattern: 'M7 Doctor', tool: 'mcp_m7_doctor', confidence: 0.90 },
  
  // Warmup record
  { pattern: 'Задача записана', tool: 'mcp_m7_warmup', action: 'record', confidence: 0.90 },
  
  // Memory push/pop
  { pattern: 'Context Saved - Diving Deeper', tool: 'mcp_m7_memory', action: 'push', confidence: 0.95 },
  { pattern: 'Returning to Parent Task', tool: 'mcp_m7_memory', action: 'pop', confidence: 0.95 },
  { pattern: 'M7 Memory: STORE_PATTERN', tool: 'mcp_m7_memory', action: 'store_pattern', confidence: 0.95 },
  { pattern: 'M7 Memory: SEARCH', tool: 'mcp_m7_memory', action: 'search', confidence: 0.95 },
  { pattern: 'M7 Memory: STORE', tool: 'mcp_m7_memory', action: 'store', confidence: 0.95 },
  
  // Contracts
  { pattern: '"contract":', tool: 'mcp_m7_contracts', confidence: 0.80 },
  
  // Impact
  { pattern: 'Impact History Report', tool: 'mcp_m7_impact', action: 'history', confidence: 0.90 },
  
  // Validation Failed (generic validate)
  { pattern: 'Validation Failed', tool: 'mcp_m7_validate', confidence: 0.75 },
  
  // Unknown action (scope errors)
  { pattern: 'Unknown action', tool: 'mcp_m7_scope', confidence: 0.60 },
];

// ─── Core Classifier ─────────────────────────────────────────────────────

function classifyEvent(event: RawEvent): ClassificationResult | null {
  // Already classified
  if (event.tool_name && event.tool_name !== '') {
    return null;
  }

  // Not a prompt_completion (investigation, hive_coordination already classified by type)
  if (event.type !== 'prompt_completion') {
    return null;
  }

  const prompt = (event.prompt || '').trim();
  const response = event.completion?.code || '';

  // Strategy 1: Exact prompt match (highest confidence)
  const exactMatch = PROMPT_EXACT_MAP[prompt.toLowerCase()];
  if (exactMatch) {
    return {
      tool_name: exactMatch.tool,
      tool_action: exactMatch.action,
      confidence: 0.95,
      method: 'prompt_exact',
    };
  }

  // Strategy 2: Prompt starts with tool name
  for (const [prefix, tool] of Object.entries(PROMPT_PREFIX_MAP)) {
    if (prompt === prefix || prompt.startsWith(prefix + ' ') || prompt.startsWith(prefix + '\n')) {
      return {
        tool_name: tool,
        confidence: 0.98,
        method: 'prompt_exact',
      };
    }
  }

  // Strategy 3: Response pattern matching
  for (const rule of RESPONSE_RULES) {
    const matches = typeof rule.pattern === 'string'
      ? response.includes(rule.pattern)
      : rule.pattern.test(response);
    
    if (matches) {
      return {
        tool_name: rule.tool,
        tool_action: rule.action,
        confidence: rule.confidence,
        method: 'response_pattern',
      };
    }
  }

  // Strategy 4: Combined heuristics for remaining events
  // Long prompts that look like task descriptions → likely analyze_task
  if (prompt.length > 30 && !prompt.startsWith('mcp_m7_') && response.includes('━━━')) {
    return {
      tool_name: 'mcp_m7_analyze_task',
      confidence: 0.75,
      method: 'combined',
    };
  }

  // Prompts with M7 cycle patterns in response
  if (response.includes('PHASE:') && response.includes('/7)')) {
    return {
      tool_name: 'mcp_m7_cycle',
      confidence: 0.85,
      method: 'response_pattern',
    };
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Retro-classify a JSONL file of telemetry events.
 * Returns classified events and statistics.
 */
export function retroClassifyFile(
  inputPath: string,
  outputPath?: string
): { stats: RetroClassificationStats; events: (RawEvent | ClassifiedEvent)[] } {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const lines = readFileSync(inputPath, 'utf-8').trim().split('\n');
  const stats: RetroClassificationStats = {
    total_events: lines.length,
    already_classified: 0,
    newly_classified: 0,
    still_unknown: 0,
    by_tool: {},
    by_method: {},
    by_confidence: { high: 0, medium: 0, low: 0 },
  };

  const outputEvents: (RawEvent | ClassifiedEvent)[] = [];

  for (const line of lines) {
    let event: RawEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-prompt_completion — they're already typed correctly
    if (event.type !== 'prompt_completion') {
      // Already have a specific type
      if (event.tool_name) {
        stats.already_classified++;
      }
      outputEvents.push(event);
      continue;
    }

    // Already has tool_name from v3.13+ instrumentation
    if (event.tool_name) {
      stats.already_classified++;
      outputEvents.push(event);
      continue;
    }

    // Attempt retro-classification
    const result = classifyEvent(event);

    if (result) {
      const classified: ClassifiedEvent = {
        ...event,
        tool_name: result.tool_name,
        tool_action: result.tool_action,
        schema_version: 2,
        _retro_classified: true,
        _classification_confidence: result.confidence,
        _classification_method: result.method,
      };

      stats.newly_classified++;
      stats.by_tool[result.tool_name] = (stats.by_tool[result.tool_name] || 0) + 1;
      stats.by_method[result.method] = (stats.by_method[result.method] || 0) + 1;

      if (result.confidence >= 0.9) stats.by_confidence.high++;
      else if (result.confidence >= 0.75) stats.by_confidence.medium++;
      else stats.by_confidence.low++;

      outputEvents.push(classified);
    } else {
      stats.still_unknown++;
      outputEvents.push(event);
    }
  }

  // Write output if path specified
  if (outputPath) {
    const outputLines = outputEvents.map(e => JSON.stringify(e));
    writeFileSync(outputPath, outputLines.join('\n') + '\n', 'utf-8');
  }

  return { stats, events: outputEvents };
}

/**
 * Run retro-classification on default paths.
 * Reads from .m7/training-data/all-events.jsonl
 * Writes to .m7/training-data/classified-events.jsonl
 */
export function runRetroClassification(projectPath?: string): RetroClassificationStats {
  const base = projectPath || getProjectPath();
  const inputPath = join(base, '.m7', 'training-data', 'all-events.jsonl');
  const outputPath = join(base, '.m7', 'training-data', 'classified-events.jsonl');

  const { stats } = retroClassifyFile(inputPath, outputPath);
  return stats;
}
