/**
 * Project Index Manager Module
 * Экспорт всех компонентов системы управления PROJECT_INDEX.md
 */

export * from './types.js';
export * from './projectScanner.js';
export * from './indexGenerator.js';
export * from './projectIndexTool.js';

// Основные классы
export { DefaultProjectScanner } from './projectScanner.js';
export { DefaultIndexGenerator } from './indexGenerator.js';

// MCP Tool
export { projectIndexTool } from './projectIndexTool.js';

// Типы и константы
export {
  DEFAULT_INDEX_SECTIONS,
  DEFAULT_EXCLUDE_PATTERNS,
  CRITICAL_CONFIG_FILES,
  IMPORTANT_DIRECTORIES
} from './types.js';
