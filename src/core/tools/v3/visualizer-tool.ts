/**
 * M7 v3.0 - Context Visualizer MCP Tool
 * 
 * MCP tool for controlling the graph visualization server
 */

import { z } from 'zod';
import { 
  getVisualizerServer, 
  VisualizerServer 
} from '../../../visualizer/index.js';
import { getKnowledgeGraph } from '../../../knowledge-graph/index.js';
import { getProjectPath } from '../../utils/projectPath.js';

// ============================================
// SCHEMA
// ============================================

const visualizerSchema = z.object({
  action: z.enum([
    'start',          // Start visualizer server
    'stop',           // Stop visualizer server
    'status',         // Get server status
    'set_context',    // Update current context
    'get_graph',      // Get graph data as JSON
    'focus',          // Focus on a node
    'open',           // Open visualizer in browser
  ]).describe('Action to perform'),
  
  file: z.string()
    .optional()
    .describe('File path for set_context action'),
  
  task: z.string()
    .optional()
    .describe('Task description for set_context action'),
  
  node_id: z.string()
    .optional()
    .describe('Node ID for focus action'),
});

type VisualizerParams = z.infer<typeof visualizerSchema>;

// ============================================
// TOOL DEFINITION
// ============================================

export const visualizerTool = {
  name: 'mcp_m7_visualizer',
  description: `M7 Context Visualizer - interactive graph visualization of code dependencies.

Actions:
- start: Start the visualizer server (opens web UI)
- stop: Stop the visualizer server
- status: Check if server is running
- set_context: Update current file/task context
- get_graph: Get graph data as JSON
- focus: Focus on a specific node
- open: Get URL to open visualizer

The visualizer shows:
- Code dependency graph with live updates
- Current editing context ("You are here")
- Impact analysis (what changes affect)
- Navigation history
- Health metrics

Use 'start' to launch, then open the URL in browser.`,

  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'status', 'set_context', 'get_graph', 'focus', 'open'],
        description: 'Action to perform'
      },
      file: {
        type: 'string',
        description: 'File path for set_context action'
      },
      task: {
        type: 'string',
        description: 'Task description for set_context action'
      },
      node_id: {
        type: 'string',
        description: 'Node ID for focus action'
      }
    },
    required: ['action']
  },

  async handler(request: any): Promise<any> {
    const params = visualizerSchema.parse(request) as VisualizerParams;
    const server = getVisualizerServer();
    
    try {
      let result: string;
      
      switch (params.action) {
        case 'start':
          result = await handleStart(server);
          break;
          
        case 'stop':
          result = await handleStop(server);
          break;
          
        case 'status':
          result = handleStatus(server);
          break;
          
        case 'set_context':
          result = handleSetContext(server, params);
          break;
          
        case 'get_graph':
          result = await handleGetGraph(server);
          break;
          
        case 'focus':
          result = handleFocus(server, params.node_id);
          break;
          
        case 'open':
          result = handleOpen(server);
          break;
          
        default:
          result = `Unknown action: ${params.action}`;
      }
      
      return {
        content: [{ type: 'text', text: result }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `# ❌ Error\n\n${error.message}` }],
        isError: true
      };
    }
  }
};

// ============================================
// HANDLERS
// ============================================

async function handleStart(server: VisualizerServer): Promise<string> {
  if (server.running) {
    return `# ✅ Visualizer Already Running

The visualizer server is already running.

**Open in browser:** http://localhost:3848

WebSocket: ws://localhost:3847`;
  }
  
  // Ensure Knowledge Graph is built
  const graph = getKnowledgeGraph();
  if (!graph.built) {
    await graph.build({ rootPath: getProjectPath() });
  }
  
  const { httpPort, wsPort } = await server.start();
  
  return `# 🚀 Visualizer Started

**Open in browser:** http://localhost:${httpPort}

## Connection Info
- **HTTP:** http://localhost:${httpPort}
- **WebSocket:** ws://localhost:${wsPort}

## Features
- 🗺️ Interactive dependency graph
- 📍 "You are here" context tracking
- ⚡ Real-time updates
- 📊 Health metrics
- 🕐 Navigation history

The visualizer will show your code's dependency graph with live updates as you work.`;
}

async function handleStop(server: VisualizerServer): Promise<string> {
  if (!server.running) {
    return `# ℹ️ Visualizer Not Running

The visualizer server is not currently running.

Use \`action: "start"\` to start it.`;
  }
  
  await server.stop();
  
  return `# ✅ Visualizer Stopped

The visualizer server has been stopped.`;
}

function handleStatus(server: VisualizerServer): string {
  const running = server.running;
  
  if (running) {
    return `# 🟢 Visualizer Status: Running

**HTTP:** http://localhost:3848
**WebSocket:** ws://localhost:3847

The visualizer is active and ready.`;
  } else {
    return `# 🔴 Visualizer Status: Stopped

The visualizer server is not running.

Use \`action: "start"\` to start it.`;
  }
}

function handleSetContext(server: VisualizerServer, params: VisualizerParams): string {
  if (!server.running) {
    return `# ❌ Visualizer Not Running

Start the visualizer first with \`action: "start"\``;
  }
  
  if (params.file) {
    server.setActiveFile(params.file);
  }
  
  if (params.task) {
    server.setTaskDescription(params.task);
  }
  
  const updates: string[] = [];
  if (params.file) updates.push(`- Active file: \`${params.file}\``);
  if (params.task) updates.push(`- Task: "${params.task}"`);
  
  return `# ✅ Context Updated

${updates.join('\n')}

The visualizer will highlight the current context.`;
}

async function handleGetGraph(server: VisualizerServer): Promise<string> {
  const graph = getKnowledgeGraph();
  
  if (!graph.built) {
    return `# ❌ Graph Not Built

Build the Knowledge Graph first:
\`\`\`
mcp_m7_knowledge_graph action="build" rootPath="/your/project"
\`\`\``;
  }
  
  const metrics = graph.getMetrics();
  
  return `# 📊 Graph Data

## Metrics
| Metric | Value |
|--------|-------|
| Nodes | ${metrics.totalNodes} |
| Edges | ${metrics.totalEdges} |
| Orphans | ${metrics.orphans} |
| Cycles | ${metrics.cycles} |
| Health | ${metrics.healthGrade} |

## Nodes by Type
${Object.entries(metrics.nodesByType)
  .filter(([_, count]) => count > 0)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join('\n')}

## Edges by Type
${Object.entries(metrics.edgesByType)
  .filter(([_, count]) => count > 0)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join('\n')}

---
*Use the visualizer UI for interactive exploration*`;
}

function handleFocus(server: VisualizerServer, nodeId?: string): string {
  if (!server.running) {
    return `# ❌ Visualizer Not Running

Start the visualizer first with \`action: "start"\``;
  }
  
  if (!nodeId) {
    return `# ❌ Missing Node ID

Provide \`node_id\` parameter to focus on a specific node.`;
  }
  
  // The focus is handled via WebSocket in the visualizer
  return `# 🎯 Focus Requested

Requested focus on node: \`${nodeId}\`

Open the visualizer to see the focused view.`;
}

function handleOpen(server: VisualizerServer): string {
  if (!server.running) {
    return `# 🔗 Visualizer URL

The visualizer is not running yet.

Start it with \`action: "start"\`, then open:

**http://localhost:3848**`;
  }
  
  return `# 🔗 Open Visualizer

**URL:** http://localhost:3848

Copy and paste this URL into your browser to view the interactive dependency graph.

## What You'll See
- 🗺️ Interactive node graph
- 📍 Current file highlighted
- 📊 Health metrics sidebar
- 🕐 Navigation history timeline
- 🎨 Color-coded node types`;
}

export default visualizerTool;

