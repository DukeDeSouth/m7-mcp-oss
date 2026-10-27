/**
 * M7 v3.5 - Smart Scope Scanner Types
 * 
 * Типы для системы сканирования scope проекта.
 * Позволяет корректировать оценку задачи на основе реальных данных кодовой базы.
 * 
 * @author M7 AI Assistant
 * @version 3.5.0
 * @date 2026-01-22
 */

import { TaskRoute } from '../types.js';

// ============================================
// TASK KEYWORDS
// ============================================

/**
 * Ключевые слова, извлечённые из описания задачи
 */
export interface TaskKeywords {
  /** Типы файлов для сканирования ['.php', '.ts'] */
  fileTypes: string[];
  
  /** Технологии упомянутые в задаче ['php7', 'typescript'] */
  technologies: string[];
  
  /** Действия ['refactor', 'migrate', 'upgrade'] */
  actions: string[];
}

// ============================================
// SCAN PATTERNS (defined in patterns.ts)
// ============================================

/**
 * Результат поиска паттерна
 */
export interface PatternMatch {
  /** Паттерн (краткое описание) */
  pattern: string;
  
  /** Количество совпадений */
  count: number;
  
  /** Количество файлов с совпадениями */
  files: number;
  
  /** Примеры совпадений (первые 3) */
  examples: string[];
}

// ============================================
// FILE STATISTICS
// ============================================

/**
 * Статистика по файлам
 */
export interface FileStats {
  /** Общее количество файлов в проекте */
  total: number;
  
  /** Количество файлов по расширению */
  byExtension: Record<string, number>;
  
  /** Количество файлов, соответствующих паттерну задачи */
  matchingPattern: number;
}

/**
 * Статистика по строкам кода
 */
export interface LineStats {
  /** Общее количество строк */
  total: number;
  
  /** Строки кода (без пустых и комментариев) */
  code: number;
  
  /** Строки в соответствующих файлах */
  inMatchingFiles: number;
}

// ============================================
// RECOMMENDATION
// ============================================

/**
 * Рекомендация по route на основе сканирования
 */
export interface ScopeRecommendation {
  /** Рекомендуемый route */
  suggestedRoute: TaskRoute;
  
  /** Рекомендуемое количество файлов */
  suggestedFiles: number;
  
  /** Рекомендуемое время в минутах */
  suggestedMinutes: number;
  
  /** Обоснование рекомендации */
  reasoning: string;
}

// ============================================
// SCOPE CONTEXT
// ============================================

/**
 * Полный контекст scope сканирования
 */
export interface ScopeContext {
  /** Время сканирования */
  scannedAt: string;
  
  /** Длительность сканирования в мс */
  scanDurationMs: number;
  
  /** Путь к проекту */
  projectPath: string;
  
  /** Статистика файлов */
  fileStats: FileStats;
  
  /** Статистика строк */
  lineStats: LineStats;
  
  /** Найденные паттерны */
  patterns: PatternMatch[];
  
  /** Рекомендация */
  recommendation: ScopeRecommendation;
  
  /** Форматированный контекст для LLM промпта */
  promptContext: string;
}

// ============================================
// SCANNER OPTIONS
// ============================================

/**
 * Опции сканирования
 */
export interface ScanOptions {
  /** Максимум файлов для быстрого подсчёта */
  maxFiles?: number;
  
  /** Максимум файлов для детального анализа */
  maxSampleFiles?: number;
  
  /** Максимальный размер файла в байтах */
  maxFileSize?: number;
  
  /** Директории для исключения */
  excludeDirs?: string[];
  
  /** Включить скрытые файлы */
  includeHidden?: boolean;
}

/**
 * Дефолтные опции сканирования
 */
export const DEFAULT_SCAN_OPTIONS: Required<ScanOptions> = {
  maxFiles: 1000,
  maxSampleFiles: 100,
  maxFileSize: 100000, // 100KB
  excludeDirs: [
    'node_modules', 'vendor', '.git', 'dist', 'build',
    '.cache', 'coverage', '__pycache__', '.venv', '.next',
    'target', 'out', 'bin', 'obj'
  ],
  includeHidden: false
};
