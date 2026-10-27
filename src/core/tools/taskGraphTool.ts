/**
 * M7 Task Graph Tool
 * 
 * MCP tool для работы с графом задач.
 * Позволяет просматривать, искать и визуализировать связи.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { getTaskGraphManager } from '../task-graph/index.js';
import { getMermaidGenerator } from '../task-graph/mermaidGenerator.js';
import { TaskStatus } from '../types/taskGraph.js';

const log = createLogger('[taskGraphTool]');

const TaskGraphRequestSchema = z.object({
  action: z.enum(['status', 'list', 'get', 'links', 'subgraph', 'visualize', 'recent']),
  filter: z.enum(['active', 'completed', 'transferred', 'cancelled', 'all']).optional(),
  limit: z.number().optional(),
  task_id: z.string().optional(),
  depth: z.number().optional()
});

export function createTaskGraphTool() {
  const graphManager = getTaskGraphManager();
  const mermaidGenerator = getMermaidGenerator();
  
  return {
    name: 'mcp_m7_task_graph',
    description: 'View and explore the task dependency graph',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list', 'get', 'links', 'subgraph', 'visualize', 'recent'],
          description: 'Graph action: status (stats), list (tasks), get (task details), links (connections), subgraph (related), visualize (mermaid), recent (latest)'
        },
        filter: {
          type: 'string',
          enum: ['active', 'completed', 'transferred', 'cancelled', 'all'],
          description: 'Filter for list action'
        },
        limit: {
          type: 'number',
          description: 'Limit results (default: 10)'
        },
        task_id: {
          type: 'string',
          description: 'Task ID for get/links/subgraph/visualize actions'
        },
        depth: {
          type: 'number',
          description: 'Depth for subgraph traversal (default: 2)'
        }
      },
      required: ['action']
    },
    handler: async (request: any) => {
      const { action, filter, limit = 10, task_id, depth = 2 } = TaskGraphRequestSchema.parse(request);
      
      await graphManager.initialize();
      
      switch (action) {
        case 'status': {
          const stats = await graphManager.getStats();
          const statsChart = mermaidGenerator.generateStatsChart({
            active: stats.activeTasks,
            completed: stats.completedTasks,
            transferred: stats.transferredTasks,
            cancelled: 0
          });
          
          return {
            content: [{
              type: 'text',
              text: `# 📊 Task Graph Status

## Статистика

| Метрика | Значение |
|---------|----------|
| **Всего задач** | ${stats.totalTasks} |
| **Активных** | ${stats.activeTasks} 🟢 |
| **Завершённых** | ${stats.completedTasks} ✅ |
| **Перенесённых** | ${stats.transferredTasks} ➡️ |
| **Всего связей** | ${stats.totalLinks} |

## Связи по типам

${Object.entries(stats.linksByType).length > 0
  ? Object.entries(stats.linksByType)
      .map(([type, count]) => `- **${type}**: ${count}`)
      .join('\n')
  : '*Нет связей*'}

## Распределение

${statsChart}`
            }]
          };
        }
        
        case 'list': {
          let tasks;
          
          if (filter && filter !== 'all') {
            tasks = await graphManager.findByStatus(filter as TaskStatus);
          } else {
            tasks = await graphManager.getRecentTasks(limit);
          }
          
          tasks = tasks.slice(0, limit);
          
          if (tasks.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `# 📋 Список задач

*Задачи не найдены${filter ? ` (фильтр: ${filter})` : ''}*

Создайте задачу: \`@m7 analyze task "описание"\``
              }]
            };
          }
          
          const taskList = tasks.map(t => {
            const statusEmoji = 
              t.status === 'active' ? '🟢' :
              t.status === 'completed' ? '✅' :
              t.status === 'transferred' ? '➡️' : '❌';
            
            return `| \`${t.id.slice(0, 25)}...\` | ${statusEmoji} ${t.status} | ${t.title.slice(0, 40)} | ${new Date(t.created).toLocaleDateString()} |`;
          }).join('\n');
          
          return {
            content: [{
              type: 'text',
              text: `# 📋 Список задач ${filter ? `(${filter})` : ''}

| ID | Статус | Название | Создана |
|----|--------|----------|---------|
${taskList}

---

**Всего:** ${tasks.length} задач${filter ? ` (фильтр: ${filter})` : ''}

Детали задачи: \`@m7 task_graph action="get" task_id="ID"\``
            }]
          };
        }
        
        case 'get': {
          if (!task_id) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Укажите task_id**

\`@m7 task_graph action="get" task_id="task_xyz"\``
              }]
            };
          }
          
          const task = await graphManager.getTask(task_id);
          
          if (!task) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Задача не найдена:** \`${task_id}\`

Список задач: \`@m7 task_graph action="list"\``
              }]
            };
          }
          
          const links = await graphManager.getTaskLinks(task_id);
          
          return {
            content: [{
              type: 'text',
              text: `# 📋 Детали задачи

## Основная информация

| Поле | Значение |
|------|----------|
| **ID** | \`${task.id}\` |
| **Название** | ${task.title} |
| **Статус** | ${task.status} |
| **Route** | ${task.route} |
| **Папка** | \`${task.folder}\` |
| **Создана** | ${new Date(task.created).toLocaleString()} |
${task.completed ? `| **Завершена** | ${new Date(task.completed).toLocaleString()} |` : ''}
${task.outcome ? `| **Результат** | ${task.outcome} |` : ''}

## Метаданные

${task.meta?.sessionId ? `- **Session ID:** \`${task.meta.sessionId}\`` : ''}
${task.meta?.interpretationConfidence ? `- **Confidence:** ${(task.meta.interpretationConfidence * 100).toFixed(0)}%` : ''}
${task.meta?.filesAffected ? `- **Затронуто файлов:** ${task.meta.filesAffected}` : ''}
${task.meta?.tags?.length ? `- **Теги:** ${task.meta.tags.join(', ')}` : ''}

## Связи

### Исходящие (${links.outgoing.length})
${links.outgoing.length > 0
  ? links.outgoing.map(l => `- → \`${l.to}\` [${l.type}]: ${l.reason}`).join('\n')
  : '*Нет исходящих связей*'}

### Входящие (${links.incoming.length})
${links.incoming.length > 0
  ? links.incoming.map(l => `- ← \`${l.from}\` [${l.type}]: ${l.reason}`).join('\n')
  : '*Нет входящих связей*'}

---

Визуализация: \`@m7 task_graph action="visualize" task_id="${task_id}"\``
            }]
          };
        }
        
        case 'links': {
          if (!task_id) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Укажите task_id**

\`@m7 task_graph action="links" task_id="task_xyz"\``
              }]
            };
          }
          
          const task = await graphManager.getTask(task_id);
          if (!task) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Задача не найдена:** \`${task_id}\``
              }]
            };
          }
          
          const links = await graphManager.getTaskLinks(task_id);
          
          const allLinks = [...links.outgoing, ...links.incoming];
          
          if (allLinks.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `# 🔗 Связи задачи \`${task_id}\`

*У этой задачи нет связей*`
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `# 🔗 Связи задачи

**Задача:** \`${task_id}\`
**Всего связей:** ${allLinks.length}

## Исходящие (${links.outgoing.length})

| Цель | Тип | Причина | Дата |
|------|-----|---------|------|
${links.outgoing.map(l => 
  `| \`${l.to.slice(0, 20)}...\` | ${l.type} | ${l.reason.slice(0, 30)} | ${new Date(l.timestamp).toLocaleDateString()} |`
).join('\n') || '*Нет*'}

## Входящие (${links.incoming.length})

| Источник | Тип | Причина | Дата |
|----------|-----|---------|------|
${links.incoming.map(l => 
  `| \`${l.from.slice(0, 20)}...\` | ${l.type} | ${l.reason.slice(0, 30)} | ${new Date(l.timestamp).toLocaleDateString()} |`
).join('\n') || '*Нет*'}`
            }]
          };
        }
        
        case 'subgraph': {
          if (!task_id) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Укажите task_id**

\`@m7 task_graph action="subgraph" task_id="task_xyz" depth=2\``
              }]
            };
          }
          
          const result = await graphManager.getSubgraph({
            centerId: task_id,
            depth: depth,
            includeCompleted: true
          });
          
          if (result.tasks.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Задача не найдена:** \`${task_id}\``
              }]
            };
          }
          
          const diagram = mermaidGenerator.generateFromSearchResult(result);
          
          return {
            content: [{
              type: 'text',
              text: `# 🕸️ Подграф задачи

**Центр:** \`${task_id}\`
**Глубина:** ${depth}
**Найдено:** ${result.tasks.length} задач, ${result.links.length} связей
**Время:** ${result.searchDurationMs}ms

## Диаграмма

${diagram}

## Задачи в подграфе

${result.tasks.map(t => `- \`${t.id}\`: ${t.title} (${t.status})`).join('\n')}`
            }]
          };
        }
        
        case 'visualize': {
          if (!task_id) {
            // Visualize all recent tasks
            const recentTasks = await graphManager.getRecentTasks(10);
            const stats = await graphManager.getStats();
            
            if (recentTasks.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `# 📊 Task Graph Visualization

*Нет задач для визуализации*`
                }]
              };
            }
            
            // Get all links for these tasks
            const allLinks: any[] = [];
            for (const task of recentTasks) {
              const links = await graphManager.getTaskLinks(task.id);
              allLinks.push(...links.outgoing);
            }
            
            const diagram = mermaidGenerator.generate(recentTasks, allLinks);
            const legend = mermaidGenerator.generateLegend();
            
            return {
              content: [{
                type: 'text',
                text: `# 📊 Task Graph Visualization

**Задач:** ${recentTasks.length}
**Связей:** ${allLinks.length}

## Граф последних задач

${diagram}

## Легенда

${legend}`
              }]
            };
          }
          
          // Visualize specific task
          const task = await graphManager.getTask(task_id);
          if (!task) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Задача не найдена:** \`${task_id}\``
              }]
            };
          }
          
          const result = await graphManager.getSubgraph({
            centerId: task_id,
            depth: depth,
            includeCompleted: true
          });
          
          const relatedTasks = result.tasks.filter(t => t.id !== task_id);
          const links = await graphManager.getTaskLinks(task_id);
          
          const diagram = mermaidGenerator.generateTaskView(
            task,
            links.outgoing,
            links.incoming,
            relatedTasks
          );
          
          return {
            content: [{
              type: 'text',
              text: `# 📊 Визуализация задачи

**Задача:** \`${task_id}\`
**Связанных:** ${relatedTasks.length}

${diagram}`
            }]
          };
        }
        
        case 'recent': {
          const tasks = await graphManager.getRecentTasks(limit);
          
          if (tasks.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `# 📋 Последние задачи

*Нет задач*`
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `# 📋 Последние ${tasks.length} задач

${tasks.map((t, i) => {
  const statusEmoji = 
    t.status === 'active' ? '🟢' :
    t.status === 'completed' ? '✅' :
    t.status === 'transferred' ? '➡️' : '❌';
  
  return `${i + 1}. ${statusEmoji} **${t.title.slice(0, 50)}**
   - ID: \`${t.id}\`
   - Создана: ${new Date(t.created).toLocaleString()}`;
}).join('\n\n')}

---

Детали: \`@m7 task_graph action="get" task_id="ID"\``
            }]
          };
        }
        
        default:
          return {
            content: [{
              type: 'text',
              text: `❌ Неизвестное действие: ${action}`
            }]
          };
      }
    }
  };
}
