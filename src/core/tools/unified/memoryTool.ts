import { z } from 'zod';
import { 
  UnifiedMemoryCore, 
  getMemoryCore,
  MemoryLevel,
  MemoryRecord,
  SourceType,
  SearchResult,
  getEpistemicView,
} from '../../../memory/auto/unified-memory-core.js';
import { normalizeFogEntry } from '../../../memory/fogBoundary.js';
import { buildConflictReport } from '../../../memory/memoryConflicts.js';
import {
  normalizeDependencySpecs,
  type MemoryRelationType,
} from '../../../memory/memoryRelations.js';
import { buildConsolidationInstruction } from '../../../memory/promotionConsolidation.js';
import { formatZodError } from '../../utils/errorFormatter.js';
import { getProjectPath } from '../../utils/projectPath.js';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('[memoryTool]');

/**
 * Map old level names to new unified levels
 */
const LEVEL_MAP: Record<string, MemoryLevel> = {
  'surface': 'L0',
  'working': 'L1',
  'longterm': 'L2',
  'conceptual': 'L3',
  'project': 'L2',  // project data goes to L2
  // Direct level names
  'L0': 'L0',
  'L1': 'L1',
  'L2': 'L2',
  'L3': 'L3',
  'L4': 'L4',
};

/**
 * Parse nested JSON strings in objects
 * MCP may pass complex objects as JSON strings
 */
function parseNestedJsonStrings(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const parsed: any = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      try {
        const parsedValue = JSON.parse(value);
        if (typeof parsedValue === 'object') {
          parsed[key] = parseNestedJsonStrings(parsedValue);
        } else {
          parsed[key] = value;
        }
      } catch {
        parsed[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      parsed[key] = parseNestedJsonStrings(value);
    } else {
      parsed[key] = value;
    }
  }
  
  return parsed;
}

/**
 * Unified Memory Tool Schema
 * 
 * Supports both old (surface/working/longterm) and new (L0-L4) level names
 */
const UnifiedMemoryRequestSchema = z.object({
  action: z.enum([
    // Core search/store
    'search',           // Cascade search across all levels
    'search_level',     // Search specific level
    'store',            // Store with auto-level detection
    'store_at',         // Store at specific level
    
    // Legacy compatibility
    'auto_search',      // → maps to search
    'store_pattern',    // → maps to store at L2
    'update_project',   // → maps to store at L2
    'discover_technical', // → FogOfWar discovery
    'query_fog_of_war', // → query low confidence
    'list',             // List records in level
    'retrieve',         // Get specific record
    
    // New unified actions
    'get',              // Get by ID
    'delete',           // Delete by ID
    'delete_bulk',      // Delete multiple by IDs
    'invalidate_bulk',  // Invalidate multiple by IDs
    'promote',          // Manual promotion
    'consolidate',      // Sprint 6: submit host-mediated L2+ summary
    'stats',            // Get statistics
    'invalidate',       // Manual invalidation
    'reload',           // Reload memory from disk
  ]),
  
  // Common params
  query: z.string().optional(),
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  
  // Level (supports both old and new names)
  level: z.enum([
    'surface', 'working', 'longterm', 'conceptual', 'project',
    'L0', 'L1', 'L2', 'L3', 'L4'
  ]).optional(),
  
  // Search params
  context: z.string().optional(),
  file_path: z.string().optional(),
  confidence_threshold: z.number().optional(),
  max_results: z.number().optional(),
  depth_levels: z.array(z.enum([
    'surface', 'working', 'longterm', 'conceptual', 'project',
    'L0', 'L1', 'L2', 'L3', 'L4'
  ])).optional(),
  
  // Store params
  content: z.string().optional(),
  context_keys: z.array(z.string()).optional(),
  source: z.enum(['code_analysis', 'runtime', 'documentation', 'experiment', 'human']).optional(),
  confidence: z.number().optional(),
  
  // Pattern storage params (legacy)
  pattern: z.object({
    name: z.string(),
    description: z.string(),
    category: z.string().optional(),
    code: z.string().optional(),
    tags: z.array(z.string()).optional(),
    problem_context: z.string().optional(),
    root_cause: z.string().optional(),
    solution_rationale: z.string().optional(),
    causal_chain: z.array(z.object({
      cause: z.string(),
      effect: z.string(),
      confidence: z.number()
    })).optional(),
    runtime_metrics: z.object({
      before: z.any().optional(),
      after: z.any().optional(),
      improvement: z.number().optional()
    }).optional(),
    decision_context: z.object({
      why_chosen: z.string(),
      alternatives_considered: z.array(z.string()).optional(),
      trade_offs: z.array(z.string()).optional()
    }).optional(),
    validation_method: z.string().optional(),
    success_criteria: z.array(z.string()).optional(),
    metadata: z.any().optional()
  }).optional(),
  
  // Project memory params (legacy)
  project: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    purpose: z.string().optional(),
    businessDomain: z.string().optional(),
    mainTechnologies: z.array(z.string()).optional(),
    keyFeatures: z.array(z.string()).optional(),
    architecture: z.string().optional()
  }).optional(),
  
  // Technical discovery params
  path: z.string().optional(),
  discovery: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  dependency_specs: z.array(z.object({
    id: z.string(),
    relationType: z.enum(['supports', 'contradicts', 'refines', 'derived_from']),
  })).optional(),
  technical_details: z.any().optional(),
  blocking: z.boolean().optional(),
  critical_path: z.boolean().optional(),
  
  // Fog of War query params
  minConfidence: z.number().optional(),
  includeInvalidated: z.boolean().optional(),
  
  // Promotion params
  target_level: z.enum(['L1', 'L2', 'L3', 'L4']).optional(),
});

function formatEpistemicLine(record: MemoryRecord): string {
  const { status, storedConfidence, effectiveConfidence } = getEpistemicView(record);
  return (
    `Epistemic: ${status} | ` +
    `Confidence: ${storedConfidence.toFixed(2)} (stored) | ` +
    `Effective: ${effectiveConfidence.toFixed(2)} | ` +
    `Source: ${record.source}`
  );
}

function buildDependencyStoreOptions(params: {
  dependencies?: string[];
  dependency_specs?: Array<{ id: string; relationType: MemoryRelationType }>;
}) {
  const { deps, relations } = normalizeDependencySpecs(
    params.dependencies,
    params.dependency_specs
  );
  return {
    dependencies: deps.length ? deps : undefined,
    dependencyRelations: Object.keys(relations).length ? relations : undefined,
  };
}

function appendConflictReportIfAny(memory: UnifiedMemoryCore, response: string): string {
  const conflicts = memory.getActiveConflicts();
  if (conflicts.length === 0) {
    return response;
  }
  const report = buildConflictReport(conflicts, (id) => memory.getRecordSync(id));
  return `${response}\n${report}\n`;
}

/**
 * Format search results for display
 */
function formatSearchResults(results: SearchResult[], query: string): string {
  let response = `**Query:** "${query}"\n`;
  response += `**Results:** ${results.length} found\n\n`;
  
  if (results.length === 0) {
    response += `No results found for "${query}"\n`;
    return response;
  }
  
  results.slice(0, 10).forEach((result, i) => {
    const { record, score, level } = result;
    response += `${i + 1}. **[${level}]** (score: ${score.toFixed(2)})\n`;
    response += `   ${record.content.substring(0, 200)}${record.content.length > 200 ? '...' : ''}\n`;
    if (record.contextKeys.length > 0) {
      response += `   Context: ${record.contextKeys.slice(0, 3).join(', ')}\n`;
    }
    response += `   ${formatEpistemicLine(record)}\n`;
    if (record.needsConsolidation) {
      response += `   ⚠️ **needs_consolidation** — use \`consolidate\` action\n`;
    }
    response += '\n';
  });
  
  if (results.length > 10) {
    response += `... and ${results.length - 10} more results\n`;
  }
  
  return response;
}

/**
 * v3.18: Route L2+ memory records to the appropriate reference file
 * based on contextKeys content analysis.
 */
function routeToReferenceFile(
  contextKeys: string[],
  content: string
): { file: string; title: string } | null {
  const allText = [...contextKeys, content].join(' ').toLowerCase();

  // Decision / ADR / lesson → CYCLE_REGISTRY.md
  if (/decision|adr|lesson|trade.?off|why\s+chose|alternative|migration/.test(allText)) {
    const title = contextKeys[0] || 'Decision';
    return { file: 'CYCLE_REGISTRY.md', title };
  }

  // Pattern / convention / standard → CODING_STANDARDS.md
  if (/pattern|convention|standard|anti.?pattern|naming|style|rule/.test(allText)) {
    const title = contextKeys[0] || 'Convention';
    return { file: 'CODING_STANDARDS.md', title };
  }

  // Architecture / system / module / design → MASTER_REFERENCE.md
  if (/architect|system|module|design|infra|deploy|depend|api|endpoint/.test(allText)) {
    const title = contextKeys[0] || 'System note';
    return { file: 'MASTER_REFERENCE.md', title };
  }

  // Default for L2+: CYCLE_REGISTRY (knowledge log)
  return { file: 'CYCLE_REGISTRY.md', title: contextKeys[0] || 'Knowledge entry' };
}

export const unifiedMemoryTool = {
  name: 'mcp_m7_memory',
  description: `Unified M7 Memory System - 5-level cognitive hierarchy with FogOfWar

## Memory Levels
- L0 (surface): Ephemeral, seconds-minutes
- L1 (working): Task context, hours-days
- L2 (longterm/project): Project patterns, weeks-months
- L3 (conceptual): Validated patterns, months-years
- L4 (global): Universal knowledge, permanent

## Actions
- search: Cascade search L0→L4 with early stop
- search_level: Search specific level
- store: Store with auto-level (default L0)
- store_at: Store at specific level
- get: Get record by ID
- delete: Delete record (from memory AND disk)
- delete_bulk: Delete multiple records by IDs array
- invalidate_bulk: Invalidate multiple records by IDs array
- stats: Memory statistics (deduplicated)
- discover_technical: Add FogOfWar discovery
- query_fog_of_war: Query low confidence areas
- promote: Manual promotion to higher level
- consolidate: Submit validated L2+ summary for needs_consolidation records
- invalidate: Mark record as invalidated
- reload: Reload memory from disk (resync after manual edits)`,
  
  inputSchema: UnifiedMemoryRequestSchema,
  
  handler: async (request: any) => {
    try {
      const parsedRequest = parseNestedJsonStrings(request);
      const params = UnifiedMemoryRequestSchema.parse(parsedRequest);
      const { action } = params;
      
      // Get or create memory core
      const memory = await getMemoryCore();
      
      let response = `# 🧠 M7 Unified Memory: ${action.toUpperCase()}\n\n`;

      switch (action) {
        // ═══════════════════════════════════════════════════════════════
        // SEARCH ACTIONS
        // ═══════════════════════════════════════════════════════════════
        
        case 'search':
        case 'auto_search': {
          const query = params.query || params.context;
          if (!query) throw new Error('Query or context required for search');
          
          const results = await memory.cascadeSearch(query, {
            confidenceThreshold: params.confidence_threshold || 0.3,
            maxResults: params.max_results || 10,
            levels: params.depth_levels?.map(l => LEVEL_MAP[l] || l as MemoryLevel),
          });
          
          response += formatSearchResults(results, query);
          break;
        }

        case 'search_level': {
          const { query, level } = params;
          if (!query) throw new Error('Query required for search_level');
          if (!level) throw new Error('Level required for search_level');
          
          const mappedLevel = LEVEL_MAP[level] || level as MemoryLevel;
          const results = await memory.semanticSearch(query, {
            level: mappedLevel,
            limit: params.max_results || 10,
          });
          
          response += `**Level:** ${level} → ${mappedLevel}\n`;
          response += formatSearchResults(results, query);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // STORE ACTIONS
        // ═══════════════════════════════════════════════════════════════
        
        case 'store': {
          const { content, context_keys, source, confidence, dependencies, dependency_specs } = params;
          if (!content) throw new Error('Content required for store');
          
          const record = await memory.store(content, {
            level: 'L0',
            contextKeys: context_keys,
            source: source as SourceType,
            confidence,
            ...buildDependencyStoreOptions({ dependencies, dependency_specs }),
          });
          
          response += `**Stored:** ${record.id}\n`;
          response += `**Level:** L0 (Ephemeral)\n`;
          response += `**Content:** ${content.substring(0, 100)}...\n\n`;
          if (record.dependencyRelations && Object.keys(record.dependencyRelations).length > 0) {
            response += `**Relations:** ${JSON.stringify(record.dependencyRelations)}\n`;
          }
          response += `✅ Record stored. Will auto-promote based on access patterns.\n`;
          response = appendConflictReportIfAny(memory, response);
          break;
        }

        case 'store_at': {
          const {
            content,
            level,
            context_keys,
            source,
            confidence,
            dependencies,
            dependency_specs,
          } = params;
          if (!content) throw new Error('Content required for store_at');
          if (!level) throw new Error('Level required for store_at');
          
          const mappedLevel = LEVEL_MAP[level] || level as MemoryLevel;
          
          const record = await memory.store(content, {
            level: mappedLevel,
            contextKeys: context_keys,
            source: source as SourceType,
            confidence,
            ...buildDependencyStoreOptions({ dependencies, dependency_specs }),
          });
          
          response += `**Stored:** ${record.id}\n`;
          response += `**Level:** ${level} → ${mappedLevel}\n`;
          response += `**Content:** ${content.substring(0, 100)}...\n\n`;
          if (record.dependencyRelations && Object.keys(record.dependencyRelations).length > 0) {
            response += `**Relations:** ${JSON.stringify(record.dependencyRelations)}\n`;
          }
          response += `✅ Record stored at ${mappedLevel}.\n`;

          // v3.18: Bridge JSON→Markdown — route L2+ to reference files
          if (['L2', 'L3', 'L4'].includes(mappedLevel)) {
            const bridgeTarget = routeToReferenceFile(context_keys || [], content);
            if (bridgeTarget) {
              try {
                const projectPath = getProjectPath();
                const filePath = path.join(projectPath, bridgeTarget.file);
                const entry = `\n### ${bridgeTarget.title}\n${content.substring(0, 500)}\n- **Level:** ${mappedLevel} | **Added:** ${new Date().toISOString().split('T')[0]}\n`;
                await fs.appendFile(filePath, entry, 'utf-8');
                response += `📝 Also synced to ${bridgeTarget.file}\n`;
              } catch (err) {
                log.debug(`Reference file sync to ${bridgeTarget.file} failed:`, err);
              }
            }
          }

          response = appendConflictReportIfAny(memory, response);
          break;
        }

        case 'store_pattern': {
          const { pattern } = params;
          if (!pattern) throw new Error('Pattern data required');
          
          const content = JSON.stringify(pattern);
          const record = await memory.store(content, {
            level: 'L2',
            contextKeys: pattern.tags || [],
            source: 'code_analysis',
            confidence: 0.8,
          });
          
          response += `**Pattern:** ${pattern.name}\n`;
          response += `**Stored:** ${record.id} at L2 (Project)\n`;
          response += `**Description:** ${pattern.description}\n\n`;
          response += `✅ Pattern successfully stored.\n`;

          // v3.17: Side-effect — append pattern to CODING_STANDARDS.md
          try {
            const projectPath = getProjectPath();
            const standardsPath = path.join(projectPath, 'CODING_STANDARDS.md');
            const entry = `\n### ${pattern.name}\n- **Description:** ${pattern.description}\n- **Tags:** ${(pattern.tags || []).join(', ') || 'none'}\n- **Added:** ${new Date().toISOString().split('T')[0]}\n`;
            await fs.appendFile(standardsPath, entry, 'utf-8');
          } catch (err) {
            log.debug('CODING_STANDARDS.md update failed (non-critical):', err);
          }

          break;
        }

        case 'update_project': {
          const { project } = params;
          if (!project) throw new Error('Project data required');
          
          const content = JSON.stringify({
            type: 'project_metadata',
            ...project,
          });
          
          const record = await memory.store(content, {
            level: 'L2',
            contextKeys: ['project', 'metadata'],
            source: 'documentation',
            confidence: 1.0,
          });
          
          response += `**Project Updated:** ${record.id}\n`;
          if (project.name) response += `- Name: ${project.name}\n`;
          if (project.description) response += `- Description: ${project.description}\n`;
          if (project.mainTechnologies) response += `- Technologies: ${project.mainTechnologies.join(', ')}\n`;
          response += `\n✅ Project memory updated at L2.\n`;

          // v3.18: Bridge → sync project metadata to MASTER_REFERENCE.md
          try {
            const projectPath = getProjectPath();
            const masterRefPath = path.join(projectPath, 'MASTER_REFERENCE.md');
            const section = [
              `\n## Project Metadata (auto-synced)`,
              project.name ? `- **Name:** ${project.name}` : '',
              project.description ? `- **Description:** ${project.description}` : '',
              project.purpose ? `- **Purpose:** ${project.purpose}` : '',
              project.businessDomain ? `- **Domain:** ${project.businessDomain}` : '',
              project.mainTechnologies ? `- **Technologies:** ${project.mainTechnologies.join(', ')}` : '',
              project.keyFeatures ? `- **Key Features:** ${project.keyFeatures.join(', ')}` : '',
              project.architecture ? `- **Architecture:** ${project.architecture}` : '',
              `- **Synced:** ${new Date().toISOString().split('T')[0]}`,
            ].filter(Boolean).join('\n') + '\n';

            let existing = '';
            try { existing = await fs.readFile(masterRefPath, 'utf-8'); } catch { /* new file */ }
            
            const marker = '## Project Metadata (auto-synced)';
            if (existing.includes(marker)) {
              const before = existing.substring(0, existing.indexOf(marker));
              const afterMarker = existing.substring(existing.indexOf(marker));
              const nextSection = afterMarker.indexOf('\n## ', 3);
              const after = nextSection > 0 ? afterMarker.substring(nextSection) : '';
              await fs.writeFile(masterRefPath, before + section.trim() + '\n' + after, 'utf-8');
            } else {
              await fs.appendFile(masterRefPath, section, 'utf-8');
            }
            response += `📝 Also synced to MASTER_REFERENCE.md\n`;
          } catch (err) {
            log.debug('MASTER_REFERENCE.md sync failed (non-critical):', err);
          }

          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // FOG OF WAR ACTIONS
        // ═══════════════════════════════════════════════════════════════
        
        case 'discover_technical': {
          const {
            path: entryPath,
            discovery,
            source = 'code_analysis',
            confidence = 0.8,
            blocking,
            critical_path,
            dependencies,
            technical_details,
          } = params;
          if (!entryPath || !discovery) throw new Error('Path and discovery required');

          const details = {
            ...(technical_details && typeof technical_details === 'object' ? technical_details : {}),
            ...(critical_path !== undefined ? { critical_path } : {}),
            ...(blocking !== undefined ? { blocking } : {}),
          };

          await memory.discoverTechnical(
            entryPath,
            discovery,
            details,
            source as SourceType,
            confidence,
            dependencies
          );

          const record = await memory.store(discovery, {
            level: 'L1',
            contextKeys: [entryPath],
            source: source as SourceType,
            confidence,
          });

          const fogEntries = await memory.getFogOfWar({ path: entryPath });
          const fogEntry = fogEntries.find(e => e.path === entryPath);
          const boundaryView = fogEntry
            ? normalizeFogEntry(fogEntry)
            : normalizeFogEntry({
                id: record.id,
                path: entryPath,
                discovery,
                technical_details: details,
                dependencies: dependencies || [],
                discovered_at: new Date(),
                confidence,
                source: source as SourceType,
              });

          response += `**Path:** ${entryPath}\n`;
          response += `**Discovery:** ${discovery}\n`;
          response += `**Source:** ${source}\n`;
          response += `**Confidence:** ${confidence}\n`;
          response += `**Boundary:** ${boundaryView.boundary_status} | blocking: ${boundaryView.blocking}\n`;
          response += `**${formatEpistemicLine(record)}**\n`;
          response += `**Record ID:** ${record.id}\n\n`;
          response += `✅ Technical discovery recorded in FogOfWar + L1.\n`;
          break;
        }

        case 'query_fog_of_war': {
          const { minConfidence = 0.5 } = params;

          const fogEntries = await memory.getFogOfWar({ includeInvalidated: false });
          const filtered = fogEntries
            .filter(e => e.confidence < minConfidence)
            .sort((a, b) => a.confidence - b.confidence);

          response += `**Threshold:** confidence < ${minConfidence}\n`;
          response += `**Results:** ${filtered.length} low-confidence fog entries\n\n`;

          filtered.slice(0, 10).forEach((entry, i) => {
            const normalized = normalizeFogEntry(entry);
            const synthetic: MemoryRecord = {
              id: entry.id,
              content: entry.discovery,
              level: 'L1',
              source: (entry.source || 'code_analysis') as SourceType,
              contextKeys: [entry.path],
              confidence: entry.confidence,
              accessCount: 0,
              createdAt: entry.discovered_at instanceof Date
                ? entry.discovered_at
                : new Date(entry.discovered_at),
              metadata: {
                type: entry.source || 'code_analysis',
                source: entry.path,
                tags: [entry.path],
                importance: entry.confidence,
              },
            };
            const view = getEpistemicView(synthetic);
            response += `${i + 1}. **\`${entry.path}\`** | boundary: ${normalized.boundary_status} | blocking: ${normalized.blocking} | epistemic: ${view.status} | conf: ${entry.confidence.toFixed(2)}\n`;
            response += `   ${entry.discovery.substring(0, 150)}${entry.discovery.length > 150 ? '...' : ''}\n\n`;
          });

          if (filtered.length > 10) {
            response += `... and ${filtered.length - 10} more fog entries below threshold\n`;
          }
          response = appendConflictReportIfAny(memory, response);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // CRUD ACTIONS
        // ═══════════════════════════════════════════════════════════════
        
        case 'get':
        case 'retrieve': {
          const id = params.id || params.query;
          if (!id) throw new Error('ID or query required for get/retrieve');
          
          const record = await memory.get(id);
          
          if (record) {
            response += `**Found:** ✅ Yes\n`;
            response += `**ID:** ${record.id}\n`;
            response += `**Level:** ${record.level}\n`;
            response += `**Epistemic:** ${getEpistemicView(record).status}\n`;
            response += `**Confidence:** ${record.confidence.toFixed(2)}\n`;
            response += `**Access Count:** ${record.accessCount}\n\n`;
            if (record.needsConsolidation) {
              const original = record.consolidatedFrom
                ? await memory.get(record.consolidatedFrom)
                : null;
              response += `${buildConsolidationInstruction(record, original)}\n\n`;
            }
            response += `\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
          } else {
            response += `**Found:** ❌ No record with ID "${id}"\n\n`;
            response += `💡 Try using \`search\` action to find records by content.\n`;
          }
          break;
        }

        case 'delete': {
          const { id } = params;
          if (!id) throw new Error('ID required for delete');
          
          const success = await memory.delete(id);
          
          if (success) {
            response += `**Deleted:** ✅ ${id}\n`;
          } else {
            response += `**Deleted:** ❌ Record not found: ${id}\n`;
          }
          break;
        }

        case 'list': {
          const { level = 'L1' } = params;
          const mappedLevel = LEVEL_MAP[level] || level as MemoryLevel;
          
          // Search with empty query to list all
          const results = await memory.cascadeSearch('', {
            levels: [mappedLevel],
            maxResults: 20,
            confidenceThreshold: 0,
          });
          
          response += `**Level:** ${level} → ${mappedLevel}\n`;
          response += `**Entries:** ${results.length}\n\n`;
          
          results.forEach((result, i) => {
            response += `${i + 1}. [${result.record.id}] ${result.record.content.substring(0, 80)}...\n`;
          });
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // MANAGEMENT ACTIONS
        // ═══════════════════════════════════════════════════════════════
        
        case 'stats': {
          const stats = await memory.getStats();
          
          response += `## Memory Statistics\n\n`;
          response += `**Project:** ${stats.projectId}\n`;
          response += `**Total Records:** ${stats.totalRecords}\n`;
          response += `**Invalidated:** ${stats.invalidatedCount}\n`;
          if (stats.lastPromotionRun) {
            response += `**Last Promotion:** ${stats.lastPromotionRun.toISOString()}\n`;
          }
          response += `\n### By Level\n\n`;
          
          stats.levels.forEach(level => {
            response += `**${level.level}:** ${level.recordCount} records, avg conf: ${level.avgConfidence.toFixed(2)}\n`;
          });
          break;
        }

        case 'promote': {
          const { id, target_level } = params;
          if (!id) throw new Error('ID required for promote');
          if (!target_level) throw new Error('target_level required for promote');

          const mappedTarget = LEVEL_MAP[target_level] || (target_level as MemoryLevel);
          const result = await memory.promoteRecord(id, mappedTarget);

          if (result.success && result.promotion) {
            const { record, fromLevel, toLevel, originalId } = result.promotion;
            response += `✅ Promoted toward **${toLevel}**\n`;
            response += `**From:** ${fromLevel} record \`${originalId ?? id}\`\n`;
            response += `**Consolidated ID:** ${record.id}\n`;
            if (record.needsConsolidation) {
              const original = originalId ? await memory.get(originalId) : null;
              response += `\n${buildConsolidationInstruction(record, original)}\n`;
            }
          } else {
            response += `⚠️ ${result.error ?? 'Promotion failed'}\n`;
          }
          break;
        }

        case 'consolidate': {
          const { id, content } = params;
          if (!id) throw new Error('ID required for consolidate');
          if (!content) throw new Error('Content required for consolidate');

          const result = await memory.applyConsolidation(id, content);
          if (result.success && result.record) {
            response += `✅ Consolidation applied to \`${result.record.id}\`\n`;
            response += `**Level:** ${result.record.level}\n`;
            response += `**Length:** ${result.record.content.length} chars\n`;
            response += `**needs_consolidation:** cleared\n`;
          } else {
            response += `❌ Consolidation rejected\n\n`;
            for (const err of result.errors ?? ['unknown error']) {
              response += `- ${err}\n`;
            }
          }
          break;
        }

        case 'invalidate': {
          const { path } = params;
          if (!path) throw new Error('Path required for invalidate');
          
          const affected = await memory.onCodeChange(path);
          
          response += `**Path:** ${path}\n`;
          response += `**Invalidated:** ${affected.length} records\n\n`;
          
          affected.slice(0, 5).forEach((record, i) => {
            response += `${i + 1}. [${record.id}] confidence → ${record.confidence.toFixed(2)}\n`;
          });
          break;
        }

        case 'reload': {
          await memory.reload();
          const reloadStats = await memory.getStats();
          response += `✅ Memory reloaded from disk\n`;
          response += `**Total Records:** ${reloadStats.totalRecords}\n`;
          for (const lvl of reloadStats.levels) {
            if (lvl.recordCount > 0) {
              response += `**${lvl.level}:** ${lvl.recordCount} records\n`;
            }
          }
          break;
        }

        case 'delete_bulk': {
          const bulkIds = params.ids;
          if (!bulkIds?.length) throw new Error('ids array required for delete_bulk');
          let bulkDeleted = 0;
          const notFound: string[] = [];
          for (const bulkId of bulkIds) {
            if (await memory.delete(bulkId)) {
              bulkDeleted++;
            } else {
              notFound.push(bulkId);
            }
          }
          response += `**Deleted:** ${bulkDeleted}/${bulkIds.length}\n`;
          if (notFound.length > 0) {
            response += `**Not found:** ${notFound.join(', ')}\n`;
          }
          break;
        }

        case 'invalidate_bulk': {
          const invIds = params.ids;
          if (!invIds?.length) throw new Error('ids array required for invalidate_bulk');
          let invTotal = 0;
          for (const invId of invIds) {
            const invRecord = await memory.get(invId);
            if (invRecord) {
              invRecord.confidence *= 0.3;
              invRecord.invalidatedAt = new Date();
              invTotal++;
            }
          }
          response += `**Invalidated:** ${invTotal}/${invIds.length} records\n`;
          break;
        }

        default:
          throw new Error(`Unknown memory action: ${action}`);
      }

      return {
        content: [{ type: 'text', text: response }]
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatZodError(error, 'mcp_m7_memory', {
          showExamples: true,
          showSchema: true
        });
      }
      
      return {
        content: [{
          type: 'text',
          text: `# ❌ Memory Operation Failed\n\nError: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
};
