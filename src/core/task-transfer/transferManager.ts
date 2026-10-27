/**
 * M7 Task Transfer Manager
 * 
 * Управляет переносом задач — когда scope вырастает
 * или требуется создать отдельную инициативу.
 * 
 * Заменяет концепцию "early-exit" — всё документируется.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import {
  TaskTransfer,
  TransferReason,
  TransferResult,
  ScopeAlert,
  ScopeChange,
  TransferRecommendation,
  ScopeCheckOptions,
  DEFAULT_SCOPE_CHECK_OPTIONS,
  SCOPE_ALERT_THRESHOLDS
} from '../types/taskTransfer.js';
import { getTaskGraphManager, TaskGraphManager } from '../task-graph/taskGraphManager.js';
import { TaskSession } from '../orchestrator/taskOrchestrator.js';
import { ScopeContext } from '../scope/types.js';

const log = createLogger('[TransferManager]');

/**
 * Данные для проверки scope
 */
export interface ScopeCheckInput {
  /** ID текущей задачи */
  taskId: string;
  
  /** Описание задачи */
  taskDescription: string;
  
  /** Начальная оценка файлов */
  initialFilesEstimate: number;
  
  /** Текущий результат scope scan */
  currentScopeContext?: ScopeContext;
  
  /** Количество обнаруженных critical рисков */
  criticalRisksCount: number;
}

/**
 * Менеджер переносов задач
 */
export class TransferManager {
  private graphManager: TaskGraphManager;
  private options: ScopeCheckOptions;
  
  constructor(options?: Partial<ScopeCheckOptions>) {
    this.graphManager = getTaskGraphManager();
    this.options = { ...DEFAULT_SCOPE_CHECK_OPTIONS, ...options };
  }
  
  /**
   * Проверяет нужен ли перенос задачи
   */
  async checkScopeAlert(input: ScopeCheckInput): Promise<ScopeAlert | null> {
    const currentFiles = input.currentScopeContext?.fileStats.matchingPattern || 0;
    const initialFiles = input.initialFilesEstimate || 1;
    const multiplier = currentFiles / initialFiles;
    
    log.debug(`Scope check: initial=${initialFiles}, current=${currentFiles}, multiplier=${multiplier.toFixed(2)}x`);
    
    // Проверяем scope expansion
    if (multiplier >= SCOPE_ALERT_THRESHOLDS.scopeExpansion) {
      return this.createScopeAlert(input, 'scope_expansion', {
        original: initialFiles,
        current: currentFiles,
        multiplier
      });
    }
    
    // Проверяем critical risks
    if (this.options.checkRisks && 
        input.criticalRisksCount >= SCOPE_ALERT_THRESHOLDS.criticalRiskCount) {
      return this.createScopeAlert(input, 'critical_risk', {
        original: 0,
        current: input.criticalRisksCount,
        multiplier: input.criticalRisksCount
      });
    }
    
    // Проверяем complexity spike (если multiplier очень большой)
    if (this.options.checkComplexity && 
        multiplier >= SCOPE_ALERT_THRESHOLDS.complexitySpike) {
      return this.createScopeAlert(input, 'complexity_spike', {
        original: initialFiles,
        current: currentFiles,
        multiplier
      });
    }
    
    return null;
  }
  
  /**
   * Создаёт alert о scope
   */
  private createScopeAlert(
    input: ScopeCheckInput,
    type: ScopeAlert['type'],
    metrics: ScopeAlert['metrics']
  ): ScopeAlert {
    const titles: Record<ScopeAlert['type'], string> = {
      'scope_expansion': '📈 Scope задачи значительно вырос',
      'complexity_spike': '🔥 Резкий рост сложности',
      'critical_risk': '🚨 Обнаружены критические риски'
    };
    
    const descriptions: Record<ScopeAlert['type'], string> = {
      'scope_expansion': `Задача затрагивает ${metrics.current} файлов вместо ожидаемых ${metrics.original}`,
      'complexity_spike': `Сложность выросла в ${metrics.multiplier.toFixed(1)}x раз`,
      'critical_risk': `Обнаружено ${metrics.current} критических рисков`
    };
    
    const recommendation = this.generateRecommendation(input, type, metrics);
    
    return {
      taskId: input.taskId,
      type,
      title: titles[type],
      description: descriptions[type],
      metrics,
      recommendation,
      detectedAt: new Date()
    };
  }
  
  /**
   * Генерирует рекомендацию по переносу
   */
  private generateRecommendation(
    input: ScopeCheckInput,
    type: ScopeAlert['type'],
    metrics: ScopeAlert['metrics']
  ): TransferRecommendation {
    const shouldTransfer = metrics.multiplier >= this.options.alertThreshold;
    
    // Генерируем название для новой задачи
    const suggestedTitle = this.generateNewTaskTitle(input.taskDescription, type);
    
    return {
      shouldTransfer,
      confidence: Math.min(0.95, 0.5 + (metrics.multiplier - 1) * 0.1),
      reasoning: shouldTransfer 
        ? `Scope вырос в ${metrics.multiplier.toFixed(1)}x раз. Рекомендуется создать отдельную инициативу.`
        : `Scope вырос, но в пределах допустимого. Можно продолжить текущую задачу.`,
      suggestedNewTaskTitle: suggestedTitle,
      transferCommand: `@m7 task_transfer reason="${type}" new_task="${suggestedTitle}"`,
      continueCommand: `@m7 continue force=true`
    };
  }
  
  /**
   * Генерирует название для новой задачи
   */
  private generateNewTaskTitle(originalDescription: string, type: ScopeAlert['type']): string {
    const prefixes: Record<ScopeAlert['type'], string> = {
      'scope_expansion': 'Расширенный scope:',
      'complexity_spike': 'Комплексная задача:',
      'critical_risk': 'Митигация рисков:'
    };
    
    // Укорачиваем оригинальное описание
    const shortDesc = originalDescription.slice(0, 50).trim();
    return `${prefixes[type]} ${shortDesc}`;
  }
  
  /**
   * Выполняет перенос задачи
   */
  async executeTransfer(
    fromTaskId: string,
    reason: TransferReason,
    description: string,
    scopeChange: ScopeChange,
    session?: TaskSession
  ): Promise<TransferResult> {
    try {
      await this.graphManager.initialize();
      
      // Генерируем ID для новой задачи
      const newTaskId = `task_${this.slugify(description)}_${Date.now().toString().slice(-4)}`;
      const newFolder = `docs/debug/${newTaskId}`;
      
      // Создаём новую задачу в графе
      const newTask = await this.graphManager.createTask({
        id: newTaskId,
        title: description,
        folder: newFolder
      });
      
      // Обновляем статус старой задачи
      await this.graphManager.updateTaskStatus(
        fromTaskId,
        'transferred',
        `Transferred to ${newTaskId}: ${description}`
      );
      
      // Создаём связь
      await this.graphManager.createLink(
        fromTaskId,
        newTaskId,
        'transferred',
        `${reason}: ${description}`
      );
      
      // Записываем transfer
      const transfer: TaskTransfer = {
        fromTaskId,
        toTaskId: newTaskId,
        reason,
        description,
        scopeChange,
        completedBeforeTransfer: session 
          ? Object.entries(session.phaseRequirements)
              .filter(([_, done]) => done)
              .map(([req]) => req)
          : [],
        pendingWork: session
          ? Object.entries(session.phaseRequirements)
              .filter(([_, done]) => !done)
              .map(([req]) => req)
          : [],
        timestamp: new Date(),
        initiatedBy: 'user'
      };
      
      log.debug(`Task transferred: ${fromTaskId} -> ${newTaskId}`);
      
      return {
        success: true,
        transfer,
        newTaskId,
        newTaskFolder: newFolder
      };
      
    } catch (error: any) {
      log.error(`Transfer failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Форматирует alert для вывода пользователю
   */
  formatAlertForOutput(alert: ScopeAlert): string {
    const lines: string[] = [];
    
    lines.push(`## ${alert.title}`);
    lines.push('');
    lines.push(alert.description);
    lines.push('');
    
    lines.push('| Метрика | Было | Стало |');
    lines.push('|---------|------|-------|');
    lines.push(`| Значение | ${alert.metrics.original} | **${alert.metrics.current}** |`);
    lines.push(`| Множитель | — | **${alert.metrics.multiplier.toFixed(1)}x** |`);
    lines.push('');
    
    const rec = alert.recommendation;
    if (rec.shouldTransfer) {
      lines.push(`### 💡 Рекомендация: Создать отдельную задачу`);
      lines.push('');
      lines.push(rec.reasoning);
      lines.push('');
      lines.push(`**Перенести:** \`${rec.transferCommand}\``);
      lines.push('');
      lines.push(`**Продолжить без переноса:** \`${rec.continueCommand}\``);
    } else {
      lines.push(`### ✅ Можно продолжить`);
      lines.push('');
      lines.push(rec.reasoning);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Превращает строку в slug для ID
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\u0040-\u1FFF\u2C00-\uD7FF\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .slice(0, 30)
      .replace(/^-+|-+$/g, '');
  }
}

// Singleton instance
let managerInstance: TransferManager | null = null;

/**
 * Получает singleton экземпляр менеджера
 */
export function getTransferManager(options?: Partial<ScopeCheckOptions>): TransferManager {
  if (!managerInstance || options) {
    managerInstance = new TransferManager(options);
  }
  return managerInstance;
}
