/**
 * M7 Task Transfer Types
 * 
 * Task Transfer = документированный перенос задачи
 * Заменяет концепцию "early-exit" — всё документируется, ничего не теряется
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Причина переноса задачи
 */
export type TransferReason = 
  | 'scope_expansion'     // Scope вырос больше ожидаемого
  | 'critical_risk'       // Обнаружен критический риск требующий отдельной работы
  | 'new_initiative'      // Требуется создание отдельной инициативы
  | 'dependency_found'    // Найдена зависимость от другой задачи
  | 'complexity_spike'    // Резкий рост сложности
  | 'user_decision';      // Пользователь решил перенести

/**
 * Изменение scope при переносе
 */
export interface ScopeChange {
  /** Количество файлов в начале */
  originalFiles: number;
  
  /** Количество файлов после Discovery */
  discoveredFiles: number;
  
  /** Множитель роста scope */
  scopeMultiplier: number;
  
  /** Описание изменения scope */
  description: string;
}

/**
 * Запись о переносе задачи
 */
export interface TaskTransfer {
  /** ID исходной задачи */
  fromTaskId: string;
  
  /** ID целевой задачи (куда перенесено) */
  toTaskId: string;
  
  /** Причина переноса */
  reason: TransferReason;
  
  /** Детальное описание причины */
  description: string;
  
  /** Изменение scope */
  scopeChange: ScopeChange;
  
  /** Что было сделано до переноса */
  completedBeforeTransfer: string[];
  
  /** Что нужно сделать в новой задаче */
  pendingWork: string[];
  
  /** Время переноса */
  timestamp: Date;
  
  /** Кто инициировал перенос */
  initiatedBy: 'system' | 'user';
}

/**
 * Alert о возможном переносе
 * 
 * Система показывает alert когда обнаруживает
 * что scope задачи значительно вырос
 */
export interface ScopeAlert {
  /** ID задачи */
  taskId: string;
  
  /** Тип alert */
  type: 'scope_expansion' | 'complexity_spike' | 'critical_risk';
  
  /** Заголовок alert */
  title: string;
  
  /** Детальное описание */
  description: string;
  
  /** Метрики */
  metrics: {
    /** Было (файлов/строк/рисков) */
    original: number;
    /** Стало */
    current: number;
    /** Множитель */
    multiplier: number;
  };
  
  /** Рекомендуемое действие */
  recommendation: TransferRecommendation;
  
  /** Время обнаружения */
  detectedAt: Date;
}

/**
 * Рекомендация по переносу
 */
export interface TransferRecommendation {
  /** Рекомендуется перенос */
  shouldTransfer: boolean;
  
  /** Уверенность в рекомендации (0-1) */
  confidence: number;
  
  /** Причина рекомендации */
  reasoning: string;
  
  /** Предлагаемое название новой задачи */
  suggestedNewTaskTitle?: string;
  
  /** Команда для выполнения переноса */
  transferCommand: string;
  
  /** Команда для продолжения без переноса */
  continueCommand: string;
}

/**
 * Результат переноса
 */
export interface TransferResult {
  /** Успешность переноса */
  success: boolean;
  
  /** Запись о переносе */
  transfer?: TaskTransfer;
  
  /** ID новой задачи */
  newTaskId?: string;
  
  /** Путь к папке новой задачи */
  newTaskFolder?: string;
  
  /** Ошибка (если не успешно) */
  error?: string;
}

/**
 * Опции для проверки scope
 */
export interface ScopeCheckOptions {
  /** Порог для alert (множитель) */
  alertThreshold: number;
  
  /** Включить проверку рисков */
  checkRisks: boolean;
  
  /** Включить проверку сложности */
  checkComplexity: boolean;
}

/**
 * Дефолтные опции проверки scope
 */
export const DEFAULT_SCOPE_CHECK_OPTIONS: ScopeCheckOptions = {
  alertThreshold: 2.0,  // Alert если scope вырос в 2+ раза
  checkRisks: true,
  checkComplexity: true
};

/**
 * Пороги для определения типа alert
 */
export const SCOPE_ALERT_THRESHOLDS = {
  /** Порог для scope_expansion */
  scopeExpansion: 2.0,
  
  /** Порог для complexity_spike */
  complexitySpike: 3.0,
  
  /** Количество critical рисков для alert */
  criticalRiskCount: 1
};
