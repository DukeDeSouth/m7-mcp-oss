/**
 * M7 Infrastructure Migrator
 * @module core/migration/migrator
 * @version 3.6.0
 * 
 * Автоматическая миграция legacy проектов при старте M7.
 * Работает бесшумно — пользователь не замечает процесс.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  InfrastructureState,
  MigrationResult,
  MigrationPlan,
  MigrationAction,
  SchemaVersion,
  CURRENT_SCHEMA_VERSION,
  VERSION_REQUIREMENTS,
} from './types.js';

// Логгер (использует M7_DEBUG)
const M7_DEBUG = process.env.M7_DEBUG === 'true';
const log = M7_DEBUG ? console.error : () => {};

/**
 * Путь к файлу состояния инфраструктуры
 */
function getInfrastructurePath(projectPath: string): string {
  return join(projectPath, '.m7', 'infrastructure.json');
}

/**
 * Прочитать текущее состояние инфраструктуры
 */
export function readInfrastructureState(projectPath: string): InfrastructureState | null {
  const filePath = getInfrastructurePath(projectPath);
  
  if (!existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as InfrastructureState;
  } catch (error) {
    log(`[M7 Migration] Failed to read infrastructure state: ${error}`);
    return null;
  }
}

/**
 * Сохранить состояние инфраструктуры
 */
export function saveInfrastructureState(projectPath: string, state: InfrastructureState): void {
  const m7Dir = join(projectPath, '.m7');
  const filePath = getInfrastructurePath(projectPath);
  
  // Ensure .m7 directory exists
  if (!existsSync(m7Dir)) {
    mkdirSync(m7Dir, { recursive: true });
  }
  
  writeFileSync(filePath, JSON.stringify(state, null, 2));
  log(`[M7 Migration] Infrastructure state saved to ${filePath}`);
}

/**
 * Создать начальное состояние инфраструктуры
 */
function createInitialState(projectPath: string): InfrastructureState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    m7Version: '3.6.0',
    initializedAt: new Date().toISOString(),
    projectPath,
    components: {
      knowledgeGraph: { initialized: false },
      chromaDB: { initialized: false },
      projectIndex: { initialized: false },
      styleGuardian: { initialized: false },
      errorDatabase: { initialized: false },
    },
  };
}

/**
 * Сравнить версии (semver-like)
 * Возвращает: 1 если a > b, -1 если a < b, 0 если равны
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.replace('legacy', '0.0.0').split('.').map(Number);
  const partsB = b.replace('legacy', '0.0.0').split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Определить план миграции
 */
export function planMigration(projectPath: string): MigrationPlan {
  const currentState = readInfrastructureState(projectPath);
  const actions: MigrationAction[] = [];
  
  // Нет состояния = legacy проект, нужна полная инициализация
  if (!currentState) {
    log(`[M7 Migration] Legacy project detected (no .m7/infrastructure.json)`);
    
    const requiredComponents = VERSION_REQUIREMENTS[CURRENT_SCHEMA_VERSION];
    for (const component of requiredComponents) {
      actions.push({
        component,
        action: 'create',
        reason: 'Component not initialized (legacy project)',
      });
    }
    
    return {
      needsMigration: true,
      currentVersion: 'none',
      targetVersion: CURRENT_SCHEMA_VERSION,
      actions,
    };
  }
  
  // Проверить версию схемы
  const versionComparison = compareVersions(CURRENT_SCHEMA_VERSION, currentState.schemaVersion);
  
  if (versionComparison <= 0) {
    // Текущая версия >= требуемой, миграция не нужна
    log(`[M7 Migration] Infrastructure up to date (${currentState.schemaVersion})`);
    return {
      needsMigration: false,
      currentVersion: currentState.schemaVersion,
      targetVersion: CURRENT_SCHEMA_VERSION,
      actions: [],
    };
  }
  
  // Нужна миграция
  log(`[M7 Migration] Upgrade needed: ${currentState.schemaVersion} → ${CURRENT_SCHEMA_VERSION}`);
  
  const requiredComponents = VERSION_REQUIREMENTS[CURRENT_SCHEMA_VERSION];
  
  for (const component of requiredComponents) {
    const componentKey = component as keyof typeof currentState.components;
    const componentState = currentState.components[componentKey];
    
    if (!componentState || !componentState.initialized) {
      actions.push({
        component,
        action: 'create',
        reason: `Component required by v${CURRENT_SCHEMA_VERSION}`,
      });
    } else {
      // Проверить нужно ли обновить компонент
      const componentVersion = componentState.version || '0.0.0';
      if (compareVersions(CURRENT_SCHEMA_VERSION, componentVersion) > 0) {
        actions.push({
          component,
          action: 'update',
          reason: `Component outdated (${componentVersion} → ${CURRENT_SCHEMA_VERSION})`,
        });
      }
    }
  }
  
  return {
    needsMigration: actions.length > 0,
    currentVersion: currentState.schemaVersion,
    targetVersion: CURRENT_SCHEMA_VERSION,
    actions,
  };
}

/**
 * Выполнить миграцию
 */
export async function executeMigration(projectPath: string): Promise<MigrationResult> {
  const startTime = Date.now();
  const plan = planMigration(projectPath);
  
  const result: MigrationResult = {
    success: true,
    fromVersion: plan.currentVersion,
    toVersion: plan.targetVersion,
    migratedComponents: [],
    skippedComponents: [],
    errors: [],
    durationMs: 0,
  };
  
  if (!plan.needsMigration) {
    result.durationMs = Date.now() - startTime;
    return result;
  }
  
  log(`[M7 Migration] Starting migration: ${plan.currentVersion} → ${plan.targetVersion}`);
  log(`[M7 Migration] Actions planned: ${plan.actions.length}`);
  
  // Прочитать или создать состояние
  let state = readInfrastructureState(projectPath) || createInitialState(projectPath);
  
  // Выполнить каждое действие
  for (const action of plan.actions) {
    try {
      log(`[M7 Migration] ${action.action.toUpperCase()} ${action.component}: ${action.reason}`);
      
      switch (action.component) {
        case 'knowledgeGraph':
          // Knowledge Graph строится отдельно в initializeKnowledgeGraph()
          // Просто помечаем как pending
          state.components.knowledgeGraph = {
            initialized: true,
            version: CURRENT_SCHEMA_VERSION,
            lastUpdated: new Date().toISOString(),
          };
          result.migratedComponents.push('knowledgeGraph');
          break;
          
        case 'projectIndex':
          // Project Index генерируется отдельно
          state.components.projectIndex = {
            initialized: true,
            version: CURRENT_SCHEMA_VERSION,
            lastUpdated: new Date().toISOString(),
          };
          result.migratedComponents.push('projectIndex');
          break;
          
        case 'styleGuardian':
          // Style Guardian просто активируется
          state.components.styleGuardian = {
            initialized: true,
            version: CURRENT_SCHEMA_VERSION,
            lastUpdated: new Date().toISOString(),
          };
          result.migratedComponents.push('styleGuardian');
          break;
          
        case 'chromaDB':
          // ChromaDB требует внешнего сервера — помечаем как pending
          const chromaUrl = process.env.CHROMA_URL;
          if (chromaUrl) {
            state.components.chromaDB = {
              initialized: true,
              version: CURRENT_SCHEMA_VERSION,
              lastUpdated: new Date().toISOString(),
            };
            result.migratedComponents.push('chromaDB');
          } else {
            state.components.chromaDB = {
              initialized: false,
              error: 'CHROMA_URL not configured',
            };
            result.skippedComponents.push('chromaDB');
          }
          break;
          
        case 'errorDatabase':
          state.components.errorDatabase = {
            initialized: true,
            version: CURRENT_SCHEMA_VERSION,
            lastUpdated: new Date().toISOString(),
          };
          result.migratedComponents.push('errorDatabase');
          break;
          
        default:
          result.skippedComponents.push(action.component);
          log(`[M7 Migration] Unknown component: ${action.component}`);
      }
    } catch (error: any) {
      result.errors.push(`${action.component}: ${error.message}`);
      log(`[M7 Migration] Error migrating ${action.component}: ${error.message}`);
    }
  }
  
  // Обновить версию схемы
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.m7Version = '3.6.0';
  state.lastMigration = new Date().toISOString();
  
  // Сохранить состояние
  try {
    saveInfrastructureState(projectPath, state);
  } catch (error: any) {
    result.errors.push(`Failed to save state: ${error.message}`);
    result.success = false;
  }
  
  result.durationMs = Date.now() - startTime;
  result.success = result.errors.length === 0;
  
  if (result.success) {
    log(`[M7 Migration] ✅ Migration completed in ${result.durationMs}ms`);
    log(`[M7 Migration] Migrated: ${result.migratedComponents.join(', ') || 'none'}`);
    log(`[M7 Migration] Skipped: ${result.skippedComponents.join(', ') || 'none'}`);
  } else {
    log(`[M7 Migration] ⚠️ Migration completed with errors: ${result.errors.join(', ')}`);
  }
  
  return result;
}

/**
 * Проверить и выполнить миграцию при необходимости (главная функция)
 */
export async function ensureInfrastructure(projectPath: string): Promise<MigrationResult> {
  return executeMigration(projectPath);
}
