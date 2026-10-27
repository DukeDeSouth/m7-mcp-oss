/**
 * M7 Warmup System Types
 * 
 * Типы для системы прогрева контекста.
 * Хранит Project Context Snapshot для быстрого старта новых чатов.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Уровень загрузки контекста
 */
export type WarmupScope = 'light' | 'standard' | 'full';

/**
 * Статус прогрева
 */
export type WarmupStatus = 'cold' | 'warming' | 'warm' | 'stale';

/**
 * Активная задача из Task Graph
 */
export interface ActiveTask {
  id: string;
  title: string;
  status: string;
  folder: string;
  created: string;
  progress?: number;
}

/**
 * Связь между задачами
 */
export interface TaskRelation {
  from: string;
  to: string;
  type: string;
  reason?: string;
}

/**
 * Ключевое решение из Memory
 */
export interface KeyDecision {
  id: string;
  decision: string;
  context?: string;
  timestamp?: string;
}

/**
 * Известная проблема
 */
export interface KnownIssue {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  area?: string;
}

/**
 * Информация о проекте
 */
export interface ProjectInfo {
  name: string;
  version: string;
  path: string;
  description: string;
  type: string;
}

/**
 * Tech Stack проекта
 */
export interface TechStack {
  runtime: string;
  language: string;
  protocol?: string;
  database?: string[];
  build: string;
  packageManager: string;
  frameworks?: string[];
}

/**
 * Текущий этап разработки
 */
export interface CurrentPhase {
  name: string;
  progress: number;
  completed: string[];
  remaining: string[];
  blockers: string[];
}

/**
 * Структура проекта (ключевые папки)
 */
export interface ProjectStructure {
  folders: Array<{
    path: string;
    description: string;
    fileCount?: number;
  }>;
  keyFiles: Array<{
    path: string;
    description: string;
  }>;
}

/**
 * MCP Tools статистика
 */
export interface ToolsInfo {
  total: number;
  categories: Array<{
    name: string;
    tools: string[];
  }>;
}

/**
 * DevOps информация
 */
export interface DevOpsInfo {
  build: string;
  start: string;
  config: string;
  logs: string;
  deploy?: string;
}

/**
 * Документация
 */
export interface DocsInfo {
  readme: string;
  roadmap?: string;
  taskDocs: string;
  knowledgeHub: string;
}

/**
 * Project Context Snapshot (PCS)
 * Полный снимок контекста проекта для прогрева
 */
export interface ProjectContextSnapshot {
  // Meta
  version: number;
  hash: string;
  timestamp: string;
  ttl: number; // Time-to-live in ms
  scope: WarmupScope;
  
  // Project Info
  project: ProjectInfo;
  techStack: TechStack;
  
  // Current State
  currentPhase: CurrentPhase;
  activeTasks: ActiveTask[];
  taskRelations: TaskRelation[];
  
  // Knowledge
  keyDecisions: KeyDecision[];
  knownIssues: KnownIssue[];
  
  // Structure
  structure: ProjectStructure;
  tools: ToolsInfo;
  devops: DevOpsInfo;
  docs: DocsInfo;
}

/**
 * Warm State — кэш прогрева
 */
export interface WarmState {
  projectId: string;
  status: WarmupStatus;
  lastWarmedAt: string;
  hash: string;
  scope: WarmupScope;
  snapshot?: ProjectContextSnapshot;
}

/**
 * Результат прогрева
 */
export interface WarmupResult {
  success: boolean;
  status: WarmupStatus;
  cached: boolean;
  duration: number;
  snapshot: ProjectContextSnapshot;
  report: string;
}

/**
 * Опции прогрева
 */
export interface WarmupOptions {
  scope?: WarmupScope;
  force?: boolean;
  ttl?: number;
}

/**
 * Константы
 */
export const WARM_STATE_PATH = '.m7/warm-state.json';
export const WARM_STATE_VERSION = 1;
export const DEFAULT_TTL = 3600000; // 1 hour
export const WARMUP_SCOPES: Record<WarmupScope, string> = {
  light: 'Быстрый (только ядро)',
  standard: 'Стандартный (ядро + задачи)',
  full: 'Полный (всё включено)'
};
