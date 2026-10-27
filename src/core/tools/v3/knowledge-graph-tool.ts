import { createLogger } from '../../utils/logger.js';
const log = createLogger('[knowledgegraphtool]');
/**
 * M7 v3.0 - Knowledge Graph MCP Tool
 * 
 * MCP tool for project dependency analysis
 */

import { z } from 'zod';
import * as path from 'path';
import { getKnowledgeGraph, KnowledgeGraph } from '../../../knowledge-graph/index.js';
import type { DiagramType } from '../../../knowledge-graph/types.js';

// ============================================
// SCHEMA
// ============================================

const knowledgeGraphSchema = z.object({
  action: z.enum([
    'build',           // Build graph from project
    'status',          // Get graph status
    'metrics',         // Get graph metrics
    'query',           // Query nodes
    'search',          // Search by name
    'dependencies',    // Get dependencies of a node
    'dependents',      // Get dependents of a node
    'impact',          // Analyze impact of changes
    'cycles',          // Detect cycles
    'orphans',         // Find orphan code
    'diagram',         // Generate diagram
    'path',            // Find path between nodes
    'critical',        // Get critical paths
    'export',          // Export graph
    'import',          // Import graph
    'clear'            // Clear graph
  ]),
  
  // Build options
  rootPath: z.string().optional().describe('Root path to scan'),
  include: z.array(z.string()).optional().describe('File patterns to include'),
  exclude: z.array(z.string()).optional().describe('File patterns to exclude'),
  
  // Query options
  nodeId: z.string().optional().describe('Node ID for operations'),
  filePath: z.string().optional().describe('File path for operations'),
  name: z.string().optional().describe('Name to search'),
  nodeType: z.enum([
    'file', 'class', 'function', 'interface', 'type',
    'variable', 'module', 'enum', 'component', 'hook',
    'api_endpoint', 'test', 'config'
  ]).optional().describe('Filter by node type'),
  
  // Diagram options
  diagramType: z.enum([
    'dependency', 'class', 'component', 'module', 'impact'
  ]).optional().describe('Type of diagram to generate'),
  maxNodes: z.number().optional().describe('Max nodes in diagram'),
  maxDepth: z.number().optional().describe('Max depth for traversal'),
  direction: z.enum(['TB', 'BT', 'LR', 'RL']).optional().describe('Diagram direction'),
  
  // Path finding
  targetId: z.string().optional().describe('Target node ID for path finding'),
  
  // Cycle detection
  includeTypeOnly: z.boolean().optional().describe('Include type-only cycles'),
  maxCycles: z.number().optional().describe('Max cycles to detect'),
  
  // Import/Export
  data: z.string().optional().describe('JSON data for import'),
  
  // Limit
  limit: z.number().optional().describe('Limit results')
});

// ============================================
// TOOL DEFINITION
// ============================================

export const knowledgeGraphTool = {
  name: 'mcp_m7_knowledge_graph',
  description: `Project Knowledge Graph - analyze code dependencies, detect cycles, find orphans, generate diagrams.

## Actions:

### build
Build graph from project directory.
- rootPath: Root directory to scan (required)
- include: File patterns to include (default: **/*.ts, **/*.tsx, **/*.js)
- exclude: File patterns to exclude (default: node_modules, dist)

### status
Get current graph status and summary.

### metrics
Get detailed graph metrics (nodes, edges, coupling, cohesion, health grade).

### query
Query nodes with filters.
- nodeType: Filter by type
- name: Filter by name (regex)
- filePath: Filter by path
- limit: Max results

### search
Search nodes by name.
- name: Name to search (required)

### dependencies
Get dependencies of a node.
- nodeId: Node ID (required)

### dependents
Get dependents of a node (what depends on it).
- nodeId: Node ID (required)

### impact
Analyze impact of changing a node or file.
- nodeId: Node ID to analyze
- filePath: File path to analyze

### cycles
Detect circular dependencies.
- maxCycles: Max cycles to return (default: 100)
- includeTypeOnly: Include type-only cycles

### orphans
Find orphan code (unused exports).

### diagram
Generate Mermaid diagram.
- diagramType: dependency, class, component, module, impact
- nodeId: Root node for impact diagram
- maxNodes: Max nodes to show
- direction: TB, BT, LR, RL

### path
Find shortest path between two nodes.
- nodeId: Source node (required)
- targetId: Target node (required)

### critical
Get most critical paths (highest impact nodes).
- limit: Number of nodes to return

### export
Export graph to JSON.

### import
Import graph from JSON.
- data: JSON string (required)

### clear
Clear the graph.
`,
  
  inputSchema: knowledgeGraphSchema,
  
  async handler(args: z.infer<typeof knowledgeGraphSchema>): Promise<string> {
    const kg = getKnowledgeGraph();
    
    try {
      switch (args.action) {
        case 'build':
          return await handleBuild(kg, args);
        case 'status':
          return handleStatus(kg);
        case 'metrics':
          return handleMetrics(kg);
        case 'query':
          return handleQuery(kg, args);
        case 'search':
          return handleSearch(kg, args);
        case 'dependencies':
          return handleDependencies(kg, args);
        case 'dependents':
          return handleDependents(kg, args);
        case 'impact':
          return handleImpact(kg, args);
        case 'cycles':
          return handleCycles(kg, args);
        case 'orphans':
          return handleOrphans(kg);
        case 'diagram':
          return handleDiagram(kg, args);
        case 'path':
          return handlePath(kg, args);
        case 'critical':
          return handleCritical(kg, args);
        case 'export':
          return handleExport(kg);
        case 'import':
          return handleImport(kg, args);
        case 'clear':
          return handleClear(kg);
        default:
          return `❌ Unknown action: ${args.action}`;
      }
    } catch (error: any) {
      log.debug('KnowledgeGraph] Error:', error);
      return `❌ Error: ${error.message}`;
    }
  }
};

// ============================================
// HANDLERS
// ============================================

async function handleBuild(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!args.rootPath) {
    return '❌ rootPath is required for build action';
  }
  
  const rootPath = path.resolve(args.rootPath);
  
  const report = await kg.build({
    rootPath,
    include: args.include,
    exclude: args.exclude
  });
  
  return `# 🏗️ Knowledge Graph Built

## Summary
- **Files Processed**: ${report.filesProcessed}
- **Files Skipped**: ${report.filesSkipped}
- **Nodes Created**: ${report.nodesCreated}
- **Edges Created**: ${report.edgesCreated}
- **Duration**: ${report.duration}ms

${report.errors.length > 0 ? `
## ⚠️ Errors (${report.errors.length})
${report.errors.slice(0, 10).map(e => `- \`${e.file}\`: ${e.error}`).join('\n')}
${report.errors.length > 10 ? `\n... and ${report.errors.length - 10} more` : ''}
` : ''}

## 📊 Quick Metrics
${formatMetricsSummary(kg.getMetrics())}
`;
}

function handleStatus(kg: KnowledgeGraph): string {
  const summary = kg.getSummary();
  
  if (!summary.isBuilt) {
    return `# 📊 Knowledge Graph Status

⚠️ **Graph not built yet**

Use \`build\` action to scan a project:
\`\`\`
action: "build"
rootPath: "/path/to/project"
\`\`\`
`;
  }
  
  return `# 📊 Knowledge Graph Status

## ✅ Graph Built
- **Nodes**: ${summary.metrics?.totalNodes || 0}
- **Edges**: ${summary.metrics?.totalEdges || 0}
- **Health Grade**: ${summary.metrics?.healthGrade || 'N/A'}

## 📈 Metrics
${formatMetricsSummary(summary.metrics!)}

## 🔄 Cycles
- **Total Cycles**: ${summary.cycleStats?.totalCycles || 0}
- **SCCs**: ${summary.cycleStats?.sccCount || 0}

## 📦 Orphans
- **Unused Exports**: ${summary.orphanCount}
`;
}

function handleMetrics(kg: KnowledgeGraph): string {
  if (!kg.built) {
    return '❌ Graph not built. Use build action first.';
  }
  
  const metrics = kg.getMetrics();
  
  return `# 📊 Knowledge Graph Metrics

## Graph Size
| Metric | Value |
|--------|-------|
| Total Nodes | ${metrics.totalNodes} |
| Total Edges | ${metrics.totalEdges} |
| Avg Degree | ${metrics.avgDegree.toFixed(2)} |
| Max Degree | ${metrics.maxDegree} |
| Components | ${metrics.components} |

## Nodes by Type
${Object.entries(metrics.nodesByType)
  .filter(([, count]) => count > 0)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join('\n')}

## Edges by Type
${Object.entries(metrics.edgesByType)
  .filter(([, count]) => count > 0)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join('\n')}

## Quality Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Coupling | ${(metrics.couplingScore * 100).toFixed(1)}% | ${metrics.couplingScore < 0.3 ? '✅' : metrics.couplingScore < 0.6 ? '⚠️' : '❌'} |
| Cohesion | ${(metrics.cohesionScore * 100).toFixed(1)}% | ${metrics.cohesionScore > 0.5 ? '✅' : metrics.cohesionScore > 0.3 ? '⚠️' : '❌'} |
| Cycles | ${metrics.cycles} | ${metrics.cycles === 0 ? '✅' : metrics.cycles < 5 ? '⚠️' : '❌'} |
| Orphans | ${metrics.orphans} | ${metrics.orphans < 5 ? '✅' : metrics.orphans < 20 ? '⚠️' : '❌'} |

## Health Grade: ${getHealthGradeEmoji(metrics.healthGrade)} ${metrics.healthGrade}
`;
}

function handleQuery(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const nodes = kg.queryNodes({
    type: args.nodeType as any,
    name: args.name,
    path: args.filePath,
    limit: args.limit || 20
  });
  
  if (nodes.length === 0) {
    return Promise.resolve('No nodes found matching the query.');
  }
  
  return Promise.resolve(`# 🔍 Query Results (${nodes.length} nodes)

${nodes.map(n => formatNode(n)).join('\n\n')}
`);
}

function handleSearch(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  if (!args.name) {
    return Promise.resolve('❌ name is required for search action');
  }
  
  const nodes = kg.searchByName(args.name).slice(0, args.limit || 20);
  
  if (nodes.length === 0) {
    return Promise.resolve(`No nodes found matching "${args.name}".`);
  }
  
  return Promise.resolve(`# 🔍 Search Results for "${args.name}" (${nodes.length})

${nodes.map(n => formatNode(n)).join('\n\n')}
`);
}

function handleDependencies(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  if (!args.nodeId) {
    return Promise.resolve('❌ nodeId is required for dependencies action');
  }
  
  const node = kg.getNode(args.nodeId);
  if (!node) {
    return Promise.resolve(`❌ Node not found: ${args.nodeId}`);
  }
  
  const deps = kg.getDependencies(args.nodeId);
  
  return Promise.resolve(`# 📦 Dependencies of "${node.name}"

**Node**: ${node.id}
**Type**: ${node.type}
**Dependencies**: ${deps.length}

${deps.length > 0 ? deps.map(d => `- **${d.name}** (${d.type}) - \`${d.filePath}\``).join('\n') : 'No dependencies found.'}
`);
}

function handleDependents(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  if (!args.nodeId) {
    return Promise.resolve('❌ nodeId is required for dependents action');
  }
  
  const node = kg.getNode(args.nodeId);
  if (!node) {
    return Promise.resolve(`❌ Node not found: ${args.nodeId}`);
  }
  
  const dependents = kg.getDependents(args.nodeId);
  
  return Promise.resolve(`# 👥 Dependents of "${node.name}"

**Node**: ${node.id}
**Type**: ${node.type}
**Dependents**: ${dependents.length}

${dependents.length > 0 ? dependents.map(d => `- **${d.name}** (${d.type}) - \`${d.filePath}\``).join('\n') : 'No dependents found.'}
`);
}

function handleImpact(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  if (args.filePath) {
    const analyses = kg.analyzeFileImpact(args.filePath);
    if (analyses.length === 0) {
      return Promise.resolve(`❌ No analysis available for file: ${args.filePath}`);
    }
    
    return Promise.resolve(`# 🎯 Impact Analysis for File

**File**: ${args.filePath}
**Exported Elements Analyzed**: ${analyses.length}

${analyses.map(a => formatImpactAnalysis(a)).join('\n---\n')}
`);
  }
  
  if (!args.nodeId) {
    return Promise.resolve('❌ nodeId or filePath is required for impact action');
  }
  
  const analysis = kg.analyzeImpact(args.nodeId);
  if (!analysis) {
    return Promise.resolve(`❌ Node not found: ${args.nodeId}`);
  }
  
  return Promise.resolve(`# 🎯 Impact Analysis

${formatImpactAnalysis(analysis)}
`);
}

function handleCycles(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const cycles = kg.detectCycles({
    maxCycles: args.maxCycles || 20,
    includeTypeOnly: args.includeTypeOnly
  });
  
  const stats = kg.getCycleStats();
  
  return Promise.resolve(`# 🔄 Cycle Detection

## Statistics
- **Total Cycles**: ${stats.totalCycles}
- **Strongly Connected Components**: ${stats.sccCount}
- **Largest SCC Size**: ${stats.largestSccSize}

## Cycles by Type
- Import cycles: ${stats.cyclesByType.import}
- Inheritance cycles: ${stats.cyclesByType.inheritance}
- Mixed cycles: ${stats.cyclesByType.mixed}

## Most Involved Files
${stats.mostInvolvedFiles.slice(0, 5).map(f => `- \`${f.file}\`: ${f.cycleCount} cycles`).join('\n')}

${cycles.length > 0 ? `
## Detected Cycles (${cycles.length})

${cycles.slice(0, 10).map((c, i) => `
### Cycle ${i + 1} (${c.severity})
**Path**: ${c.path}
**Suggestion**: ${c.suggestion}
`).join('\n')}
${cycles.length > 10 ? `\n... and ${cycles.length - 10} more cycles` : ''}
` : '\n✅ No cycles detected!'}
`);
}

function handleOrphans(kg: KnowledgeGraph): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const orphans = kg.findOrphans();
  
  return Promise.resolve(`# 📦 Orphan Detection

**Total Orphans Found**: ${orphans.length}

${orphans.length > 0 ? orphans.slice(0, 20).map(o => `
### ${o.node.name}
- **Type**: ${o.node.type}
- **File**: \`${o.node.filePath}\`
- **Reason**: ${o.reason}
- **Confidence**: ${(o.confidence * 100).toFixed(0)}%
- **Suggestion**: ${o.suggestion}
`).join('\n') : '✅ No orphan code detected!'}
${orphans.length > 20 ? `\n... and ${orphans.length - 20} more orphans` : ''}
`);
}

function handleDiagram(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const diagramType = args.diagramType || 'dependency';
  
  const diagram = kg.generateDiagram({
    type: diagramType as DiagramType,
    format: 'mermaid',
    rootNode: args.nodeId,
    maxNodes: args.maxNodes || 30,
    maxDepth: args.maxDepth || 3,
    direction: args.direction || 'TB'
  });
  
  return Promise.resolve(`# 📊 ${diagramType.charAt(0).toUpperCase() + diagramType.slice(1)} Diagram

\`\`\`mermaid
${diagram}
\`\`\`
`);
}

function handlePath(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  if (!args.nodeId || !args.targetId) {
    return Promise.resolve('❌ nodeId and targetId are required for path action');
  }
  
  const path = kg.findPath(args.nodeId, args.targetId);
  
  if (!path) {
    return Promise.resolve(`❌ No path found between nodes`);
  }
  
  return Promise.resolve(`# 🛤️ Path Found

**From**: ${args.nodeId}
**To**: ${args.targetId}
**Length**: ${path.length} nodes

## Path
${path.map((n, i) => `${i + 1}. **${n.name}** (${n.type})`).join('\n')}
`);
}

function handleCritical(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const critical = kg.getCriticalPaths(args.limit || 10);
  
  return Promise.resolve(`# ⚠️ Critical Paths

**Most impactful nodes** (changing these affects the most code):

${critical.map((c, i) => `
### ${i + 1}. ${c.node.name}
- **Type**: ${c.node.type}
- **File**: \`${c.node.filePath}\`
- **Dependents**: ${c.dependentCount}
- **Impact Score**: ${c.impactScore}
`).join('\n')}
`);
}

function handleExport(kg: KnowledgeGraph): Promise<string> {
  if (!kg.built) {
    return Promise.resolve('❌ Graph not built. Use build action first.');
  }
  
  const data = kg.export();
  
  return Promise.resolve(`# 📤 Graph Exported

\`\`\`json
${JSON.stringify(data, null, 2).slice(0, 5000)}
${JSON.stringify(data).length > 5000 ? '\n... (truncated)' : ''}
\`\`\`
`);
}

function handleImport(
  kg: KnowledgeGraph,
  args: z.infer<typeof knowledgeGraphSchema>
): Promise<string> {
  if (!args.data) {
    return Promise.resolve('❌ data is required for import action');
  }
  
  try {
    const data = JSON.parse(args.data);
    kg.import(data);
    
    return Promise.resolve(`# 📥 Graph Imported

✅ Successfully imported graph with ${kg.nodeCount} nodes and ${kg.edgeCount} edges.
`);
  } catch (error: any) {
    return Promise.resolve(`❌ Invalid JSON data: ${error.message}`);
  }
}

function handleClear(kg: KnowledgeGraph): Promise<string> {
  kg.clear();
  return Promise.resolve('✅ Knowledge graph cleared.');
}

// ============================================
// HELPERS
// ============================================

function formatNode(node: any): string {
  return `### ${node.name}
- **ID**: \`${node.id}\`
- **Type**: ${node.type}
- **File**: \`${node.filePath}\`${node.line ? ` (line ${node.line})` : ''}
- **Exported**: ${node.metadata.exported ? '✅' : '❌'}`;
}

function formatImpactAnalysis(analysis: any): string {
  const riskEmoji: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴'
  };
  
  return `## ${analysis.node.name}

- **Type**: ${analysis.node.type}
- **Risk Level**: ${riskEmoji[analysis.riskLevel]} ${analysis.riskLevel.toUpperCase()}
- **Impact Score**: ${analysis.impactScore}/100

### Direct Impact (${analysis.directImpact.length})
${analysis.directImpact.slice(0, 5).map((d: any) => `- ${d.name} (${d.type})`).join('\n') || 'None'}
${analysis.directImpact.length > 5 ? `\n... and ${analysis.directImpact.length - 5} more` : ''}

### Transitive Impact (${analysis.transitiveImpact.length})
${analysis.transitiveImpact.slice(0, 5).map((d: any) => `- ${d.name} (${d.type})`).join('\n') || 'None'}
${analysis.transitiveImpact.length > 5 ? `\n... and ${analysis.transitiveImpact.length - 5} more` : ''}

### Affected Files (${analysis.affectedFiles.length})
${analysis.affectedFiles.slice(0, 5).map((f: string) => `- \`${f}\``).join('\n')}
${analysis.affectedFiles.length > 5 ? `\n... and ${analysis.affectedFiles.length - 5} more` : ''}

### Suggested Tests (${analysis.suggestedTests.length})
${analysis.suggestedTests.slice(0, 3).map((t: string) => `- \`${t}\``).join('\n') || 'None found'}`;
}

function formatMetricsSummary(metrics: any): string {
  return `| Metric | Value |
|--------|-------|
| Nodes | ${metrics.totalNodes} |
| Edges | ${metrics.totalEdges} |
| Coupling | ${(metrics.couplingScore * 100).toFixed(1)}% |
| Cohesion | ${(metrics.cohesionScore * 100).toFixed(1)}% |
| Health | ${metrics.healthGrade} |`;
}

function getHealthGradeEmoji(grade: string): string {
  const emojis: Record<string, string> = {
    'A': '🏆',
    'B': '✅',
    'C': '⚠️',
    'D': '🟠',
    'F': '❌'
  };
  return emojis[grade] || '❓';
}

export default knowledgeGraphTool;

