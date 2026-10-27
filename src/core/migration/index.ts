/**
 * M7 Infrastructure Migration System
 * @module core/migration
 * @version 3.6.0
 * 
 * Автоматическая миграция legacy проектов.
 * 
 * Используется при старте M7 для:
 * - Обнаружения legacy проектов (без .m7/)
 * - Автоматической инициализации инфраструктуры
 * - Обновления устаревших компонентов
 */

export * from './types.js';
export {
  readInfrastructureState,
  saveInfrastructureState,
  planMigration,
  executeMigration,
  ensureInfrastructure,
} from './migrator.js';
