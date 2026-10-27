/**
 * M7 Infrastructure Migration Types
 * @module core/migration/types
 * @version 3.6.0
 * 
 * Типы для системы автоматической миграции legacy проектов
 */

/**
 * Версия схемы инфраструктуры
 * Каждая версия может требовать определённых действий при миграции
 */
export type SchemaVersion = '3.6.0' | '3.5.0' | '3.1.0' | '3.0.0' | '2.0.0' | 'legacy';

/**
 * Состояние компонента инфраструктуры
 */
export interface ComponentState {
  initialized: boolean;
  version?: string;
  lastUpdated?: string;
  error?: string;
}

/**
 * Состояние инфраструктуры проекта
 */
export interface InfrastructureState {
  /** Версия схемы инфраструктуры */
  schemaVersion: SchemaVersion;
  
  /** Версия M7 которая инициализировала инфраструктуру */
  m7Version: string;
  
  /** Дата первичной инициализации */
  initializedAt: string;
  
  /** Дата последнего обновления */
  lastMigration?: string;
  
  /** Состояние компонентов */
  components: {
    knowledgeGraph: ComponentState;
    chromaDB: ComponentState;
    projectIndex: ComponentState;
    styleGuardian: ComponentState;
    errorDatabase: ComponentState;
  };
  
  /** Путь к проекту (для валидации) */
  projectPath: string;
}

/**
 * Результат миграции
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: SchemaVersion | 'none';
  toVersion: SchemaVersion;
  migratedComponents: string[];
  skippedComponents: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Действие миграции
 */
export interface MigrationAction {
  component: string;
  action: 'create' | 'update' | 'rebuild' | 'skip';
  reason: string;
}

/**
 * План миграции
 */
export interface MigrationPlan {
  needsMigration: boolean;
  currentVersion: SchemaVersion | 'none';
  targetVersion: SchemaVersion;
  actions: MigrationAction[];
}

/**
 * Текущая версия схемы инфраструктуры
 */
export const CURRENT_SCHEMA_VERSION: SchemaVersion = '3.6.0';

/**
 * Минимальные требования для каждой версии
 */
export const VERSION_REQUIREMENTS: Record<SchemaVersion, string[]> = {
  '3.6.0': ['knowledgeGraph', 'projectIndex', 'styleGuardian'],
  '3.5.0': ['projectIndex'],
  '3.1.0': ['projectIndex'],
  '3.0.0': ['chromaDB'],
  '2.0.0': [],
  'legacy': [],
};
