/**
 * M7 Compliance Types
 * 
 * Типы для отслеживания соблюдения M7 полных циклов.
 * Используется для behavioral anchoring.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Запись о задаче
 */
export interface TaskRecord {
  id: string;
  timestamp: string;
  isFullCycle: boolean;
  success: boolean;
  duration?: number;      // в секундах
  phases?: string[];      // какие фазы были пройдены
}

/**
 * Дневная статистика
 */
export interface DayRecord {
  date: string;           // "2026-01-26"
  totalTasks: number;
  fullCycleTasks: number;
  successfulTasks: number;
  avgDuration?: number;
}

/**
 * Тренд
 */
export type ComplianceTrend = 'improving' | 'stable' | 'declining' | 'unknown';

/**
 * Полная статистика
 */
export interface ComplianceStats {
  version: number;
  lastUpdated: string;
  
  // Текущий день
  today: {
    tasks: number;
    fullCycle: number;
    rate: number;        // 0-100%
  };
  
  // История (последние 30 дней)
  history: DayRecord[];
  
  // Агрегаты
  last7Days: {
    tasks: number;
    fullCycle: number;
    rate: number;
    successRate: number;
  };
  
  // Тренд
  trend: ComplianceTrend;
}

/**
 * Конфигурация compliance
 */
export interface ComplianceConfig {
  version: number;
  records: DayRecord[];
  todayTasks: TaskRecord[];
}

/**
 * M7 Policy (для warmup)
 */
export interface M7Policy {
  shortText: string;       // Краткое правило (< 120 tokens)
  fullText: string;        // Полный текст
  exceptions: string[];    // Когда можно пропустить цикл
  currentStats?: {
    rate: number;
    trend: ComplianceTrend;
    message: string;
  };
}

/**
 * Константы
 */
export const COMPLIANCE_FILE = '.m7/compliance.json';
export const COMPLIANCE_VERSION = 1;
export const MAX_HISTORY_DAYS = 30;

/**
 * Default M7 Policy Text
 */
export const DEFAULT_M7_POLICY: M7Policy = {
  shortText: `**M7 Policy**: Все задачи → полный цикл (Discovery→Architecture→Plan→Implement→Validate). Fast-path только для тривиальных правок <5 строк или по явной команде.`,
  
  fullText: `## ⚡ M7 Operating Policy

**Default Mode**: Каждая задача выполняется через полный M7 цикл:
1. **Discovery** — исследование проблемы
2. **Architecture** — анализ текущей системы
3. **Planning** — план реализации
4. **Implementation** — выполнение по плану
5. **Validation** — проверка результата

**Fast-path исключения** (только когда указано):
- Тривиальные правки < 5 строк кода
- Явная команда \`--quick\` или "быстро"
- Информационные запросы без изменений кода

**Почему это важно**:
- Полные циклы = меньше ошибок
- Документация = воспроизводимость
- Структура = предсказуемость`,

  exceptions: [
    'Правки < 5 строк',
    'Явная команда --quick',
    'Информационные запросы'
  ]
};
