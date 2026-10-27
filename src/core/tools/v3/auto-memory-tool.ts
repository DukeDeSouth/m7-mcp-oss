/**
 * M7 v3.0 - Auto Memory Tool
 * 
 * MCP тул для управления автоматической памятью
 */

import { z } from 'zod';
import { MemoryManager, getMemoryManager } from '../../../memory/auto/index.js';

const AutoMemoryRequestSchema = z.object({
  action: z.enum([
    'status',           // Статус системы
    'list_projects',    // Список проектов
    'switch_project',   // Переключить проект
    'index',            // Индексировать текущий проект
    'search',           // Поиск по памяти
    'config',           // Конфигурация
    'stats',            // Детальная статистика
  ]),
  
  // Для switch_project
  project_path: z.string().optional(),
  
  // Для search
  query: z.string().optional(),
  limit: z.number().default(5).optional(),
  
  // Для config
  config_key: z.string().optional(),
  config_value: z.any().optional(),
});

export const autoMemoryTool = {
  name: 'mcp_m7_auto_memory',
  description: `Manage M7 v3.0 Auto Memory System - multi-project support with automatic context injection.

## Actions:

### status
Get current status of auto-memory system.

### list_projects  
List all registered projects with their status.

### switch_project
Switch to a different project.
- project_path: Path to the project directory (required)

### index
Index the current project into memory.

### search  
Search memory for relevant content.
- query: Search query (required)
- limit: Max results (default: 5)

### config
View or update configuration.
- config_key: Key to view/update (optional)
- config_value: New value (optional, omit to view)

### stats
Get detailed statistics about memory usage.
`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'list_projects', 'switch_project', 'index', 'search', 'config', 'stats'],
        description: 'Action to perform',
      },
      project_path: {
        type: 'string',
        description: 'Path to project for switch_project action',
      },
      query: {
        type: 'string',
        description: 'Search query for search action',
      },
      limit: {
        type: 'number',
        default: 5,
        description: 'Max results for search',
      },
      config_key: {
        type: 'string',
        description: 'Configuration key',
      },
      config_value: {
        description: 'Configuration value',
      },
    },
    required: ['action'],
  },

  handler: async (request: any): Promise<{ content: Array<{ type: string; text: string }> }> => {
    const params = AutoMemoryRequestSchema.parse(request);
    const { action } = params;

    try {
      const manager = getMemoryManager();

      switch (action) {
        case 'status': {
          const activeProject = await manager.getActiveProject();
          const projects = await manager.listProjects();
          
          return {
            content: [{
              type: 'text',
              text: `# 🧠 M7 Auto Memory Status

## Active Project
${activeProject 
  ? `**${activeProject.displayName}** (\`${activeProject.id}\`)
- Path: \`${activeProject.path}\`
- Technologies: ${activeProject.technologies.join(', ') || 'Detecting...'}
- Index Status: ${activeProject.indexStatus}
- Chunks: ${activeProject.chunkCount}
- Last Indexed: ${activeProject.lastIndexed?.toLocaleString() || 'Never'}` 
  : '⚠️ No active project. Use \`switch_project\` to set one.'}

## Registered Projects
${projects.length > 0 
  ? projects.map(p => `- **${p.displayName}** (${p.indexStatus}) - ${p.chunkCount} chunks`).join('\n')
  : 'No projects registered yet.'}

## Auto Context Injection
- analyze_task: ${manager.shouldInject('analyzeTask') ? '✅ Enabled' : '❌ Disabled'}
- hive_coordinator: ${manager.shouldInject('hiveCoordinator') ? '✅ Enabled' : '❌ Disabled'}
- session: ${manager.shouldInject('session') ? '✅ Enabled' : '❌ Disabled'}

---
*M7 v3.0 Auto Memory System*`,
            }],
          };
        }

        case 'list_projects': {
          const projects = await manager.listProjects();
          const activeId = manager.getActiveProjectId();
          
          return {
            content: [{
              type: 'text',
              text: `# 📁 Registered Projects

${projects.length === 0 ? 'No projects registered.' : projects.map(p => `
## ${p.id === activeId ? '🟢' : '⚪'} ${p.displayName}
- **ID:** \`${p.id}\`
- **Path:** \`${p.path}\`
- **Technologies:** ${p.technologies.join(', ') || 'Unknown'}
- **Index Status:** ${p.indexStatus}
- **Chunks:** ${p.chunkCount}
- **Last Accessed:** ${p.lastAccessed.toLocaleString()}
- **Last Indexed:** ${p.lastIndexed?.toLocaleString() || 'Never'}
`).join('\n---\n')}

---
Total: ${projects.length} projects
Active: ${activeId || 'None'}`,
            }],
          };
        }

        case 'switch_project': {
          if (!params.project_path) {
            return {
              content: [{
                type: 'text',
                text: '❌ Error: project_path is required for switch_project action',
              }],
            };
          }

          const project = await manager.setActiveProject(params.project_path);
          
          return {
            content: [{
              type: 'text',
              text: `# ✅ Project Switched

**Active Project:** ${project.displayName}
- **ID:** \`${project.id}\`
- **Path:** \`${project.path}\`
- **Technologies:** ${project.technologies.join(', ') || 'Detecting...'}
- **Index Status:** ${project.indexStatus}
- **Chunks in Memory:** ${project.chunkCount}

${project.indexStatus === 'none' 
  ? '⚠️ Project not indexed. Run \`@m7 auto_memory action="index"\` to index.' 
  : '✅ Ready for context injection.'}`,
            }],
          };
        }

        case 'index': {
          const activeProject = await manager.getActiveProject();
          if (!activeProject) {
            return {
              content: [{
                type: 'text',
                text: '❌ Error: No active project. Use switch_project first.',
              }],
            };
          }

          const startTime = Date.now();
          const report = await manager.indexProject();
          const duration = Date.now() - startTime;
          
          return {
            content: [{
              type: 'text',
              text: `# 📊 Indexing Complete

**Project:** ${activeProject.displayName}

## Results
- ✅ Indexed: ${report.indexed} files
- ⏭️ Skipped: ${report.skipped} files
- ❌ Errors: ${report.errors.length}
- ⏱️ Duration: ${(duration / 1000).toFixed(1)}s

${report.errors.length > 0 ? `
## Errors
${report.errors.slice(0, 5).map(e => `- ${e}`).join('\n')}
${report.errors.length > 5 ? `... and ${report.errors.length - 5} more` : ''}
` : ''}

---
Project is now indexed and ready for context injection.`,
            }],
          };
        }

        case 'search': {
          if (!params.query) {
            return {
              content: [{
                type: 'text',
                text: '❌ Error: query is required for search action',
              }],
            };
          }

          const context = await manager.enrichContext(params.query);
          
          return {
            content: [{
              type: 'text',
              text: `# 🔍 Search Results

**Query:** "${params.query}"
**Project:** ${context.projectInfo.name}
**Found:** ${context.relevantChunks.length} results
**Search Time:** ${context.searchDuration}ms
**Source:** ${context.source}

${context.relevantChunks.length === 0 
  ? '⚠️ No results found. Try indexing the project first.'
  : context.relevantChunks.map((chunk, i) => `
## ${i + 1}. ${chunk.source} (${(chunk.score * 100).toFixed(0)}% match)
**Type:** ${chunk.type} | **Language:** ${chunk.language || 'unknown'}

\`\`\`${chunk.language || ''}
${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? '\n... (truncated)' : ''}
\`\`\`
`).join('\n---\n')}

---
**Token Estimate:** ~${context.tokenCount} tokens`,
            }],
          };
        }

        case 'config': {
          // TODO: Implement configuration management
          return {
            content: [{
              type: 'text',
              text: `# ⚙️ Auto Memory Configuration

## Current Settings
- **Max Pool Size:** 5 collections
- **Pool TTL:** 30 minutes
- **Context Max Tokens:** 4000
- **Search Top K:** 5
- **Min Score:** 0.65

## Triggers
- analyze_task: ✅
- hive_coordinator: ✅
- session: ❌

---
*Configuration UI coming in future update*`,
            }],
          };
        }

        case 'stats': {
          const stats = await manager.getStats();
          
          return {
            content: [{
              type: 'text',
              text: `# 📊 Auto Memory Statistics

## Overview
- **Total Projects:** ${stats.totalProjects}
- **Active in Memory:** ${stats.activeProjects}
- **Total Chunks:** ${stats.totalChunks}
- **Total Queries:** ${stats.totalQueries}

## Performance
- **Cache Hit Rate:** ${(stats.cacheHitRate * 100).toFixed(1)}%
- **Memory Usage:** ~${stats.memoryUsageMb} MB
- **API Costs Saved:** ~$${stats.savedApiCost.toFixed(4)}

## Projects
${stats.projects.map(p => `
### ${p.name}
- Chunks: ${p.chunks}
- Queries: ${p.queries}
- Last Accessed: ${p.lastAccessed.toLocaleString()}
`).join('\n')}

---
*M7 v3.0 Auto Memory - Powered by ChromaDB + OpenAI*`,
            }],
          };
        }

        default:
          return {
            content: [{
              type: 'text',
              text: `❌ Unknown action: ${action}`,
            }],
          };
      }
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `# ❌ Auto Memory Error

**Action:** ${action}
**Error:** ${error.message}

## Troubleshooting
1. Make sure ChromaDB is running: \`docker run -p 8000:8000 chromadb/chroma\`
2. Check OPENAI_API_KEY is set
3. Check CHROMA_URL is set (default: http://localhost:8000)

---
*If the issue persists, check the M7 server logs*`,
        }],
      };
    }
  },
};

