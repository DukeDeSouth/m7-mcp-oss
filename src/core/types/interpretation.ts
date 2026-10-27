/**
 * M7 Task Interpretation Types
 * 
 * Interpretation = резюме Discovery фазы
 * Показывает пользователю что AI нашёл и как понял задачу
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Найденный файл в процессе Discovery
 */
export interface DiscoveredFile {
  path: string;
  relevance: number;  // 0-1
  reason?: string;    // Почему релевантен
}

/**
 * Похожий код найденный в проекте
 */
export interface SimilarCodeMatch {
  file: string;
  line: number;
  snippet: string;
  keyword: string;
  relevance: number;  // 0-1
}

/**
 * Контекст обнаруженный в Discovery фазе
 */
export interface DiscoveredContext {
  /** Найденные релевантные файлы (из Scope Scanner) */
  filesFound: DiscoveredFile[];
  
  /** Похожий код в проекте (из Architecture Context) */
  similarCode: SimilarCodeMatch[];
  
  /** Инсайты из прошлых сессий (из Cross-Session Learning) */
  pastInsights: string[];
  
  /** Краткое описание архитектурного контекста */
  architectureContext: string | null;
  
  /** Предупреждения из Project Schema */
  schemaWarnings: string[];
  
  /** Статистика сканирования */
  scanStats: {
    totalFilesScanned: number;
    matchingFiles: number;
    scanDurationMs: number;
  };
}

/**
 * Полная интерпретация задачи
 * 
 * Генерируется ПОСЛЕ Discovery фазы на основе собранных данных
 */
export interface TaskInterpretation {
  /** Уникальный ID интерпретации */
  id: string;
  
  /** ID связанной задачи */
  taskId: string;
  
  /** Краткое резюме понимания задачи (1-2 предложения) */
  summary: string;
  
  /** Детальное описание понимания */
  detailedUnderstanding: string;
  
  /** Контекст обнаруженный в Discovery */
  discoveredContext: DiscoveredContext;
  
  /** Предположения AI о задаче */
  assumptions: string[];
  
  /** Рекомендуемый подход к решению */
  suggestedApproach: string;
  
  /** Потенциальные риски обнаруженные на этапе Discovery */
  identifiedRisks: string[];
  
  /** Уверенность в интерпретации (0-1) */
  confidence: number;
  
  /** Источники информации использованные для интерпретации */
  basedOn: InterpretationSource[];
  
  /** Время генерации */
  generatedAt: Date;
  
  /** Версия формата */
  version: number;
}

/**
 * Источник информации для интерпретации
 */
export type InterpretationSource = 
  | 'scope_scanner'
  | 'architecture_context'
  | 'cross_session'
  | 'project_schema'
  | 'memory_system'
  | 'intent_classifier';

/**
 * Результат генерации интерпретации
 */
export interface InterpretationResult {
  success: boolean;
  interpretation?: TaskInterpretation;
  error?: string;
  durationMs: number;
}

/**
 * Формат вывода интерпретации для пользователя
 */
export type InterpretationOutputFormat = 'compact' | 'detailed' | 'hybrid';

/**
 * Опции генерации интерпретации
 */
export interface InterpretationOptions {
  /** Формат вывода */
  outputFormat: InterpretationOutputFormat;
  
  /** Включать детали Discovery */
  includeDiscoveryDetails: boolean;
  
  /** Максимальное количество файлов в выводе */
  maxFilesInOutput: number;
  
  /** Максимальное количество похожего кода */
  maxSimilarCodeInOutput: number;
}

/**
 * Дефолтные опции интерпретации
 */
export const DEFAULT_INTERPRETATION_OPTIONS: InterpretationOptions = {
  outputFormat: 'hybrid',
  includeDiscoveryDetails: true,
  maxFilesInOutput: 5,
  maxSimilarCodeInOutput: 3
};
