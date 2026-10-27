/**
 * M7 Task Graph Types
 * 
 * Soft-linking система для хранения связей между задачами
 * Обеспечивает историю development и трекинг эскалаций
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Статус задачи в графе
 */
export type TaskStatus = 
  | 'active'       // В процессе работы
  | 'completed'    // Успешно завершена
  | 'transferred'  // Перенесена в другую задачу
  | 'cancelled';   // Отменена

/**
 * Тип связи между задачами
 */
export type TaskLinkType = 
  | 'spawned'      // Одна задача породила другую
  | 'transferred'  // Задача перенесена
  | 'related'      // Связанные задачи (контекстуально)
  | 'parent'       // Родительская задача
  | 'blocks'       // Одна задача блокирует другую
  | 'depends_on';  // Зависимость

/**
 * Узел в графе задач
 */
export interface TaskNode {
  /** Уникальный ID задачи */
  id: string;
  
  /** Заголовок задачи (из task_description) */
  title: string;
  
  /** Текущий статус */
  status: TaskStatus;
  
  /** Route всегда HEAVY (после эволюции M7) */
  route: 'heavy';
  
  /** Путь к папке задачи в docs/debug/ */
  folder: string;
  
  /** Дата создания */
  created: Date;
  
  /** Дата завершения (если завершена) */
  completed?: Date;
  
  /** Краткое описание результата */
  outcome?: string;
  
  /** Метаданные */
  meta?: {
    /** ID сессии в orchestrator */
    sessionId?: string;
    
    /** Confidence из интерпретации */
    interpretationConfidence?: number;
    
    /** Количество связанных файлов */
    filesAffected?: number;
    
    /** Теги для поиска */
    tags?: string[];
  };
}

/**
 * Связь между задачами
 */
export interface TaskLink {
  /** ID исходной задачи */
  from: string;
  
  /** ID целевой задачи */
  to: string;
  
  /** Тип связи */
  type: TaskLinkType;
  
  /** Причина создания связи */
  reason: string;
  
  /** Сила связи (0-1, для related) */
  strength?: number;
  
  /** Время создания связи */
  timestamp: Date;
  
  /** Кто создал связь */
  createdBy: 'system' | 'user';
}

/**
 * Полный граф задач
 */
export interface TaskGraph {
  /** Версия формата графа */
  version: number;
  
  /** Узлы (задачи) */
  nodes: Record<string, TaskNode>;
  
  /** Связи между задачами */
  links: TaskLink[];
  
  /** Метаданные графа */
  meta: {
    /** Последнее обновление */
    lastUpdated: Date;
    
    /** Количество активных задач */
    activeTasksCount: number;
    
    /** Количество завершённых задач */
    completedTasksCount: number;
  };
}

/**
 * Метаданные задачи (хранятся в TASK_META.json в папке задачи)
 */
export interface TaskMeta {
  /** ID задачи */
  taskId: string;
  
  /** Заголовок */
  title: string;
  
  /** Оригинальное описание задачи */
  originalDescription: string;
  
  /** Интерпретация (если была сгенерирована) */
  interpretation?: {
    summary: string;
    assumptions: string[];
    confidence: number;
    generatedAt: Date;
  };
  
  /** Discovery данные */
  discovery?: {
    filesFound: number;
    similarCodeMatches: number;
    scanDurationMs: number;
  };
  
  /** История переносов */
  transfers?: Array<{
    to: string;
    reason: string;
    timestamp: Date;
  }>;
  
  /** Связанные задачи (ID) */
  relatedTasks?: string[];
  
  /** Временные метки */
  timestamps: {
    created: Date;
    lastActivity: Date;
    completed?: Date;
  };
}

/**
 * Результат поиска в графе
 */
export interface TaskGraphSearchResult {
  /** Найденные задачи */
  tasks: TaskNode[];
  
  /** Связи между найденными задачами */
  links: TaskLink[];
  
  /** Время поиска */
  searchDurationMs: number;
}

/**
 * Опции для построения подграфа
 */
export interface SubgraphOptions {
  /** Центральная задача */
  centerId: string;
  
  /** Глубина обхода */
  depth: number;
  
  /** Типы связей для включения */
  linkTypes?: TaskLinkType[];
  
  /** Включать завершённые задачи */
  includeCompleted: boolean;
}

/**
 * Путь к файлу графа
 */
export const TASK_GRAPH_PATH = '.m7/task-graph.json';

/**
 * Имя файла метаданных задачи
 */
export const TASK_META_FILENAME = 'TASK_META.json';

/**
 * Версия формата графа
 */
export const TASK_GRAPH_VERSION = 1;
