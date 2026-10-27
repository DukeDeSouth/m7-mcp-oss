/**
 * M7 Warmup MCP Tool v3.0
 * 
 * MCP инструмент для прогрева контекста проекта.
 * Команда "прогрей м7" загружает полный контекст и выдаёт
 * прозрачный отчёт пользователю для проверки.
 * 
 * v2.0: Добавлен Behavioral Anchoring — M7 Policy инжектится
 * в начало отчёта для закрепления поведения.
 * 
 * v2.1: FIX - Использует MCP Roots для определения ТЕКУЩЕГО workspace,
 * а не директории где запущен MCP сервер.
 * 
 * v3.0: NEW FEATURES:
 * - project_path parameter для явного указания проекта
 * - akstis action — команда "акстись" для runtime correction
 * - Интеграция с Project Identity System (PIS)
 * 
 * @version 3.0.0
 * @since M7 v4.0
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../utils/logger.js';
import { getWarmupManager, resetWarmupManager } from '../warmup/warmupManager.js';
import { getComplianceTracker } from '../compliance/complianceTracker.js';
import { WarmupScope, WARMUP_SCOPES } from '../types/warmup.js';
import { applyProjectPath, ensureProjectPathResolved } from '../utils/projectPath.js';

const log = createLogger('[WarmupTool]');

/**
 * Схема входных параметров
 */
export const WarmupToolSchema = z.object({
  action: z.enum([
    'warmup',           // Прогреть контекст
    'status',           // Проверить статус
    'invalidate',       // Сбросить кэш
    'record',           // Записать compliance (full_cycle или quick)
    'compliance',       // Показать статистику compliance
    'akstis'            // Команда "акстись" — runtime correction
  ]).describe(
    'Action: warmup, status, invalidate, record, compliance, akstis (возврат к M7)'
  ),
  
  scope: z.enum(['light', 'standard', 'full']).optional().describe(
    'Scope: light (только ядро), standard (ядро + задачи), full (всё)'
  ),
  
  force: z.boolean().optional().default(false).describe(
    'Force: принудительный прогрев, игнорируя кэш'
  ),
  
  // Для action: record
  full_cycle: z.boolean().optional().describe(
    'Была ли задача выполнена через полный M7 цикл'
  ),
  
  success: z.boolean().optional().default(true).describe(
    'Была ли задача успешной'
  ),
  
  // NEW: Explicit project path parameter
  project_path: z.string().optional().describe(
    'Explicit path to project directory. If not provided, auto-detected from MCP roots or environment.'
  )
});

export type WarmupToolRequest = z.infer<typeof WarmupToolSchema>;

/**
 * Обработчик MCP tool
 */
export async function handleWarmupTool(
  request: WarmupToolRequest, 
  server?: McpServer
): Promise<string> {
  let projectPath: string;
  if (request.project_path) {
    projectPath = applyProjectPath(request.project_path);
    resetWarmupManager();
  } else {
    projectPath = await ensureProjectPathResolved(server);
  }

  log.debug(`WarmupTool] Using project path: ${projectPath}`);

  const manager = getWarmupManager(projectPath);
  
  switch (request.action) {
    case 'warmup': {
      log.debug(`WarmupTool] Starting warmup (scope: ${request.scope || 'standard'}, force: ${request.force})`);
      
      const result = await manager.warmup({
        scope: request.scope as WarmupScope,
        force: request.force
      });
      
      let output = result.report;
      
      // Add cache info
      if (result.cached) {
        output = `> ℹ️ **Использован кэш** (${Math.round(result.duration)}ms)\n\n` + output;
      } else {
        output = `> ✨ **Свежий прогрев** (${Math.round(result.duration)}ms)\n\n` + output;
      }
      
      return output;
    }
    
    case 'status': {
      const status = await manager.getStatus();
      
      let output = `## 📊 M7 Warmup Status\n\n`;
      output += `| Параметр | Значение |\n`;
      output += `|----------|----------|\n`;
      
      const statusIcon = status.status === 'warm' ? '🟢' : 
                        status.status === 'stale' ? '🟡' : '🔴';
      output += `| Статус | ${statusIcon} **${status.status.toUpperCase()}** |\n`;
      
      if (status.age !== undefined) {
        const ageMin = Math.round(status.age / 60000);
        output += `| Возраст | ${ageMin} мин назад |\n`;
      }
      
      if (status.scope) {
        output += `| Scope | ${WARMUP_SCOPES[status.scope]} |\n`;
      }
      
      output += `\n`;
      
      if (status.status === 'cold') {
        output += `💡 **Совет:** Запустите \`@m7 warmup\` для прогрева контекста.\n`;
      } else if (status.status === 'stale') {
        output += `💡 **Совет:** Кэш устарел. Запустите \`@m7 warmup --force\` для обновления.\n`;
      } else {
        output += `✅ Контекст прогрет и актуален.\n`;
      }
      
      return output;
    }
    
    case 'invalidate': {
      await manager.invalidate();
      
      return `## ✅ Кэш сброшен\n\nWarm state удалён. При следующем \`@m7 warmup\` будет выполнен полный прогрев.\n`;
    }
    
    case 'record': {
      const compliance = getComplianceTracker();
      await compliance.initialize();
      
      const isFullCycle = request.full_cycle ?? false;
      const success = request.success ?? true;
      
      await compliance.recordTask(isFullCycle, success);
      
      const stats = compliance.getTodayStats();
      const cycleType = isFullCycle ? 'полный M7 цикл' : 'quick task';
      
      return `## ✅ Задача записана\n\n` +
             `| Параметр | Значение |\n` +
             `|----------|----------|\n` +
             `| Тип | ${cycleType} |\n` +
             `| Успех | ${success ? '✅' : '❌'} |\n\n` +
             `**Статистика сегодня:** ${stats.fullCycle}/${stats.tasks} full-cycle (${stats.rate}%)\n`;
    }
    
    case 'compliance': {
      const compliance = getComplianceTracker();
      await compliance.initialize();
      
      const stats = compliance.getStats(7);
      const trendEmoji = stats.trend === 'improving' ? '📈' :
                        stats.trend === 'declining' ? '📉' : '➡️';
      
      let output = `## 📊 M7 Compliance Statistics\n\n`;
      
      output += `### Сегодня\n\n`;
      output += `| Метрика | Значение |\n`;
      output += `|---------|----------|\n`;
      output += `| Задач | ${stats.today.tasks} |\n`;
      output += `| Full-cycle | ${stats.today.fullCycle} |\n`;
      output += `| Rate | **${stats.today.rate}%** |\n\n`;
      
      output += `### Последние 7 дней\n\n`;
      output += `| Метрика | Значение |\n`;
      output += `|---------|----------|\n`;
      output += `| Всего задач | ${stats.last7Days.tasks} |\n`;
      output += `| Full-cycle | ${stats.last7Days.fullCycle} |\n`;
      output += `| Rate | **${stats.last7Days.rate}%** |\n`;
      output += `| Success rate | ${stats.last7Days.successRate}% |\n`;
      output += `| Тренд | ${trendEmoji} ${stats.trend} |\n\n`;
      
      if (stats.history.length > 0) {
        output += `### История по дням\n\n`;
        output += `| Дата | Задач | Full-cycle | Rate |\n`;
        output += `|------|-------|------------|------|\n`;
        
        for (const day of stats.history.slice(-7).reverse()) {
          const rate = day.totalTasks > 0 
            ? Math.round((day.fullCycleTasks / day.totalTasks) * 100) 
            : 0;
          output += `| ${day.date} | ${day.totalTasks} | ${day.fullCycleTasks} | ${rate}% |\n`;
        }
      }
      
      return output;
    }
    
    case 'akstis': {
      log.debug(`WarmupTool] АКСТИСЬ triggered — returning to M7`);
      
      // Get Project Identity for constraints reminder
      const { IdentityManager } = await import('../identity/identityManager.js');
      const identityManager = new IdentityManager(projectPath);
      const identity = await identityManager.loadIdentity() || await identityManager.detectIdentity();
      
      // Get compliance stats
      const complianceForAkstis = getComplianceTracker(projectPath);
      await complianceForAkstis.initialize();
      const akstisStats = complianceForAkstis.getStats(7);
      
      // ─── Build AKSTIS response: Full M7 methodology briefing ───
      let output = `# АКСТИСЬ — M7 Methodology Briefing\n\n`;
      output += `**Прочитай полностью. Не пропускай. Не "адаптируй".**\n\n`;
      
      // ─── Project Identity (dynamic) ───
      output += `---\n\n## Текущий проект\n\n`;
      output += `| Constraint | Value |\n`;
      output += `|------------|-------|\n`;
      output += `| **Language** | ${identity.constraints.language} |\n`;
      output += `| **Framework** | ${identity.constraints.framework} |\n`;
      if (identity.constraints.migrations?.status === 'completed') {
        output += `| **Migration** | ${identity.constraints.migrations.from} → ${identity.constraints.migrations.to} |\n`;
      }
      output += `\n`;
      
      if (identity.forbidden.length > 0) {
        output += `**НЕ ИСПОЛЬЗОВАТЬ:** `;
        output += identity.forbidden.slice(0, 5).join(', ');
        output += `\n\n`;
      }
      
      // ─── Compliance stats (dynamic) ───
      if (akstisStats.last7Days.tasks > 0) {
        const problemRate = 100 - akstisStats.last7Days.rate;
        output += `**Статистика (7 дней):** С M7 → ${akstisStats.last7Days.successRate}% успех. Без M7 → ${problemRate}% проблем.\n\n`;
      }
      
      // ─── What is M7 (static) ───
      output += `---\n\n## Что такое M7\n\n`;
      output += `M7 — MCP-сервер оркестратор. Ты (AI) не решаешь сам когда писать код — M7 говорит что делать на каждом этапе.\n\n`;
      
      // ─── Why it matters — real cases (static) ───
      output += `## Зачем — реальные кейсы\n\n`;
      output += `### С M7: 10 мин подготовки → работает\n\n`;
      output += `- **webpack #11671** (5 лет, 82 реакции): DISCOVERY нашёл 2 root cause вместо 1. IMPACT предсказал regression с runtimeChunk. 30 строк, принято.\n`;
      output += `- **TypeScript #34933** (6 лет, 155 реакций): INTAKE за 5 мин нашёл что 2 подхода уже rejected. Без M7 = rejected PR. Нашли другой путь, 31 строка, принято.\n`;
      output += `- **TypeScript #13948** (9 лет, 128 реакций): INTAKE за 3 мин: баг уже пофикшен нами в PR #63113. Без M7 = часы впустую.\n`;
      output += `- **TypeORM #3357** (6 лет): DISCOVERY показал баг не в MigrationGenerator, а в RdbmsSchemaQueryRunner. Без M7 = фикс в неправильном месте.\n\n`;
      output += `### Без M7: 5 часов → кирпич\n\n`;
      output += `- AI получает задачу → сразу пишет код → не учёл контекст → ломает зависимости → 5 часов дебага → сервер лежит → человек ждёт 6 часов.\n`;
      output += `- Production-сервер: freestyle починил бы 1-2 симптома из 8 реальных проблем. Остальное всплывает в 3 ночи.\n\n`;
      
      // ─── Comparison table (static) ───
      output += `| Freestyle AI | M7 AI |\n`;
      output += `|-------------|-------|\n`;
      output += `| Видит задачу → пишет код | Видит задачу → исследует → потом пишет |\n`;
      output += `| Чинит симптом | Находит root cause |\n`;
      output += `| 1 root cause | Все root causes |\n`;
      output += `| Не проверяет историю | INTAKE: кто пробовал, что rejected |\n`;
      output += `| Ломает то, что не видел | IMPACT предсказывает что сломается |\n`;
      output += `| **5 часов + кирпич** | **30 мин + работает** |\n\n`;
      
      // ─── 7 phases (static) ───
      output += `---\n\n## 7 фаз цикла (порядок фиксированный)\n\n`;
      output += `| # | Фаза | Что делать | НЕ делать |\n`;
      output += `|---|------|-----------|----------|\n`;
      output += `| 1 | **INTAKE** | Понять задачу. Критерии успеха. | НЕ предлагать решения |\n`;
      output += `| 2 | **DISCOVERY** | Grep, Read, Search. Найти ВСЕ связанные файлы. | НЕ менять файлы |\n`;
      output += `| 3 | **ARCHITECTURE** | Описать текущую архитектуру. Зависимости. | НЕ проектировать решение |\n`;
      output += `| 4 | **SOLUTION** | Спроектировать решение. Что, где, почему. | НЕ писать финальный код |\n`;
      output += `| 5 | **IMPACT** | Что сломается? Edge cases? | НЕ митигировать, только перечислить |\n`;
      output += `| 6 | **SIMULATION** | Драфт кода. Черновик. | НЕ коммитить |\n`;
      output += `| 7 | **IMPLEMENTATION** | Реализация по симуляции. | НЕ отклоняться от плана |\n\n`;
      
      // ─── How to use (static) ───
      output += `## Как использовать\n\n`;
      output += '```\n';
      output += `// Начать цикл:\n`;
      output += `@m7 cycle task_description="описание задачи"\n\n`;
      output += `// Завершить фазу:\n`;
      output += `@m7 cycle task_id="cycle_xxx" artifact_content="результат"\n`;
      output += '```\n\n';
      
      // ─── Routing (static) ───
      output += `## Маршруты\n\n`;
      output += `| Маршрут | Когда | Фазы |\n`;
      output += `|---------|-------|------|\n`;
      output += `| **LIGHT** | Простое, 1 изменение | INTAKE → IMPLEMENTATION |\n`;
      output += `| **MEDIUM** | Несколько файлов | INTAKE → DISCOVERY → SOLUTION → IMPL |\n`;
      output += `| **HEAVY** | Архитектурное | Все 7 фаз |\n\n`;
      
      // ─── Key tools (static) ───
      output += `## Ключевые инструменты\n\n`;
      output += `| Tool | Зачем |\n`;
      output += `|------|-------|\n`;
      output += `| \`mcp_m7_analyze_task\` | Анализ задачи, маршрут |\n`;
      output += `| \`mcp_m7_memory\` | Память проекта (5 уровней) |\n`;
      output += `| \`mcp_m7_session\` | Управление сессией, compliance |\n`;
      output += `| \`mcp_m7_hive_coordinator\` | Мультиагентный анализ |\n`;
      output += `| \`mcp_m7_warmup\` | Прогрев контекста проекта |\n`;
      output += `| \`mcp_m7_scope\` | Контроль scope creep |\n\n`;
      
      // ─── Common mistakes (static) ───
      output += `## Типичные ошибки\n\n`;
      output += `| Ошибка | Последствие | Решение |\n`;
      output += `|--------|-----------|--------|\n`;
      output += `| Сразу код | Ломает зависимости | INTAKE → DISCOVERY сначала |\n`;
      output += `| Пропуск Discovery | Фикс не там | grep ВСЕ связанные файлы |\n`;
      output += `| Игнор Impact | Regression в prod | Перечисли что сломается |\n`;
      output += `| Хотфикс | Вернётся через неделю | Полное решение через цикл |\n`;
      output += `| Не проверил историю | Повторяет rejected подход | INTAKE: кто пробовал до тебя? |\n\n`;
      
      // ─── Rules (static) ───
      output += `## Правила\n\n`;
      output += `1. Перед кодом — \`@m7 analyze task\`\n`;
      output += `2. Критические риски блокируют прогресс\n`;
      output += `3. Новые библиотеки — Context7 (\`@context7\`)\n`;
      output += `4. UI изменения — Playwright (\`@playwright\`)\n`;
      output += `5. Баг в коде, не в кеше. Полные решения, не хотфиксы.\n`;
      output += `6. Отвечай на русском. \`м7:\` = новый таск.\n\n`;
      
      output += `---\n\n`;
      output += `**10 минут структуры сейчас = минус 5 часов боли потом. Следуй M7.**\n`;
      
      return output;
    }
    
    default:
      return `❌ Unknown action: ${request.action}`;
  }
}

/**
 * Tool definition для регистрации
 */
/**
 * Создаёт MCP tool для warmup системы
 * 
 * @param server - MCP Server instance для получения roots (workspace)
 * @returns MCP Tool definition
 */
export function createWarmupTool(server?: McpServer) {
  return {
    name: 'mcp_m7_warmup',
    description: 'M7 Warmup System — прогрев контекста проекта для нового чата. Загружает полную информацию о проекте и выдаёт отчёт для проверки.',
    inputSchema: WarmupToolSchema,
    handler: (request: WarmupToolRequest) => handleWarmupTool(request, server)
  };
}
