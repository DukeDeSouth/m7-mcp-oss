/**
 * M7 Task Transfer Tool
 * 
 * MCP tool для управления переносом задач.
 * Позволяет явно переносить задачи когда scope вырастает.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { TaskOrchestrator } from '../orchestrator/taskOrchestrator.js';
import { getTransferManager, TransferManager } from '../task-transfer/index.js';
import { getTaskGraphManager, TaskGraphManager } from '../task-graph/index.js';
import { TransferReason } from '../types/taskTransfer.js';

const log = createLogger('[taskTransferTool]');

const TaskTransferRequestSchema = z.object({
  action: z.enum(['transfer', 'check_scope', 'history']),
  reason: z.string().optional(),
  new_title: z.string().optional(),
  task_id: z.string().optional(),
  session_id: z.string().optional()
});

export function createTaskTransferTool(orchestrator: TaskOrchestrator) {
  const transferManager = getTransferManager();
  const graphManager = getTaskGraphManager();
  
  return {
    name: 'mcp_m7_task_transfer',
    description: 'Transfer tasks when scope grows beyond original estimate',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['transfer', 'check_scope', 'history'],
          description: 'Transfer action: transfer (execute), check_scope (check if needed), history (view transfers)'
        },
        reason: {
          type: 'string',
          description: 'Reason for transfer (required for transfer action)'
        },
        new_title: {
          type: 'string',
          description: 'Title for the new task (optional, auto-generated if not provided)'
        },
        task_id: {
          type: 'string',
          description: 'Task ID for history lookup'
        },
        session_id: {
          type: 'string',
          description: 'Session ID (optional, uses active session)'
        }
      },
      required: ['action']
    },
    handler: async (request: any) => {
      const { action, reason, new_title, task_id, session_id } = TaskTransferRequestSchema.parse(request);
      
      // Get current session
      await orchestrator.ready();
      const sessions = orchestrator.getAllActiveSessions();
      const currentSession = session_id 
        ? sessions.find(s => s.id === session_id)
        : sessions[0];
      
      switch (action) {
        case 'transfer': {
          if (!currentSession) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Нет активной сессии**

Для переноса нужна активная M7 сессия.
Начните с: \`@m7 analyze task "описание"\``
              }]
            };
          }
          
          if (!reason) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Требуется причина переноса**

Укажите причину:
\`@m7 task_transfer action="transfer" reason="Scope вырос, требуется рефакторинг"\``
              }]
            };
          }
          
          const transferReason: TransferReason = 
            reason.toLowerCase().includes('scope') ? 'scope_expansion' :
            reason.toLowerCase().includes('risk') ? 'critical_risk' :
            reason.toLowerCase().includes('complex') ? 'complexity_spike' :
            'user_decision';
          
          const title = new_title || `Продолжение: ${currentSession.taskDescription.slice(0, 50)}`;
          
          const result = await transferManager.executeTransfer(
            currentSession.id,
            transferReason,
            title,
            {
              originalFiles: 3,
              discoveredFiles: 10,
              scopeMultiplier: 3.3,
              description: reason
            },
            currentSession
          );
          
          if (result.success) {
            return {
              content: [{
                type: 'text',
                text: `# ✅ Задача перенесена

## Исходная задача
**ID:** \`${currentSession.id}\`
**Статус:** Transferred

## Новая задача
**ID:** \`${result.newTaskId}\`
**Папка:** \`${result.newTaskFolder}\`
**Название:** ${title}

## Причина переноса
${reason}

## Что было сделано
${result.transfer?.completedBeforeTransfer.length 
  ? result.transfer.completedBeforeTransfer.map(r => `- ✅ ${r}`).join('\n')
  : '- Нет завершённых требований'}

## Что нужно сделать
${result.transfer?.pendingWork.length
  ? result.transfer.pendingWork.map(r => `- ⏳ ${r}`).join('\n')
  : '- Нет pending требований'}

---

💡 **Следующий шаг:** \`@m7 analyze task "${title}"\``
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ **Ошибка переноса**

${result.error}

Попробуйте ещё раз или создайте новую задачу вручную.`
              }]
            };
          }
        }
        
        case 'check_scope': {
          if (!currentSession) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Нет активной сессии**

Для проверки scope нужна активная M7 сессия.`
              }]
            };
          }
          
          // Check scope using transfer manager
          const scopeCheck = await transferManager.checkScopeAlert({
            taskId: currentSession.id,
            taskDescription: currentSession.taskDescription,
            initialFilesEstimate: 3,
            currentScopeContext: undefined,
            criticalRisksCount: 0
          });
          
          if (scopeCheck) {
            const alertOutput = transferManager.formatAlertForOutput(scopeCheck);
            return {
              content: [{
                type: 'text',
                text: `# ⚠️ Scope Alert Detected

${alertOutput}

---

**Текущая сессия:** \`${currentSession.id}\`
**Фаза:** ${currentSession.currentPhase}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `# ✅ Scope в норме

**Сессия:** \`${currentSession.id}\`
**Фаза:** ${currentSession.currentPhase}

Scope задачи в пределах нормы. Перенос не требуется.

---

Если вы всё же хотите перенести задачу:
\`@m7 task_transfer action="transfer" reason="ваша причина"\``
              }]
            };
          }
        }
        
        case 'history': {
          await graphManager.initialize();
          
          const targetTaskId = task_id || currentSession?.id;
          
          if (!targetTaskId) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Укажите task_id**

\`@m7 task_transfer action="history" task_id="task_xyz"\``
              }]
            };
          }
          
          const links = await graphManager.getTaskLinks(targetTaskId);
          const task = await graphManager.getTask(targetTaskId);
          
          if (!task) {
            return {
              content: [{
                type: 'text',
                text: `❌ **Задача не найдена:** \`${targetTaskId}\``
              }]
            };
          }
          
          const transferLinks = links.outgoing.filter(l => l.type === 'transferred');
          const spawnedLinks = links.outgoing.filter(l => l.type === 'spawned');
          const incomingTransfers = links.incoming.filter(l => l.type === 'transferred');
          
          return {
            content: [{
              type: 'text',
              text: `# 📋 История задачи

## Задача
**ID:** \`${task.id}\`
**Название:** ${task.title}
**Статус:** ${task.status}
**Создана:** ${new Date(task.created).toLocaleString()}
${task.completed ? `**Завершена:** ${new Date(task.completed).toLocaleString()}` : ''}

## Переносы ИЗ этой задачи (${transferLinks.length})
${transferLinks.length > 0 
  ? transferLinks.map(l => `- → \`${l.to}\`: ${l.reason} (${new Date(l.timestamp).toLocaleString()})`).join('\n')
  : '*Нет переносов*'}

## Порождённые задачи (${spawnedLinks.length})
${spawnedLinks.length > 0
  ? spawnedLinks.map(l => `- → \`${l.to}\`: ${l.reason}`).join('\n')
  : '*Нет порождённых задач*'}

## Перенесено В эту задачу (${incomingTransfers.length})
${incomingTransfers.length > 0
  ? incomingTransfers.map(l => `- ← \`${l.from}\`: ${l.reason}`).join('\n')
  : '*Эта задача не является результатом переноса*'}`
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
