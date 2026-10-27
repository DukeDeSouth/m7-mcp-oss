/**
 * M7 Extension System v1.0
 * 
 * Pi-стиль: один .ts/.js файл с функцией-экспортом.
 * Discovery: ~/.m7/extensions/ (глобальные) → .m7/extensions/ (проектные)
 * 
 * @version 1.0.0
 * @since M7 v3.10.3
 */

import path from 'path';
import fs from 'fs/promises';
import { homedir } from 'os';
import { createLogger } from '../utils/logger.js';
import { getProjectPath } from '../utils/projectPath.js';
import {
  M7Event,
  EventHandler,
  on as eventOn,
  off as eventOff,
  getEventEmitter
} from '../events/eventSystem.js';

const log = createLogger('[Extensions]');

// ============================================================================
// Types
// ============================================================================

/**
 * Определение инструмента для расширения
 */
export interface ExtensionToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
  handler: (args: any) => Promise<any>;
}

/**
 * API доступное расширениям
 */
export interface M7ExtensionAPI {
  /** Зарегистрировать новый инструмент */
  registerTool(tool: ExtensionToolDefinition): void;
  
  /** Заменить обработчик существующего инструмента */
  replaceTool(name: string, handler: (args: any) => Promise<any>): void;
  
  /** Подписаться на событие M7 */
  on(event: M7Event, handler: EventHandler): string;
  
  /** Отписаться от события */
  off(event: M7Event, handlerId: string): void;
  
  /** Получить конфигурацию */
  getConfig(): M7ExtensionConfig;
  
  /** Операции с памятью */
  memory: {
    store(content: string, level?: string): Promise<string>;
    search(query: string): Promise<any[]>;
  };
  
  /** Логгер */
  log: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };
}

/**
 * Конфигурация расширения
 */
export interface M7ExtensionConfig {
  projectPath: string;
  m7Path: string;
  version: string;
}

/**
 * Тип функции расширения
 */
export type ExtensionFunction = (api: M7ExtensionAPI) => void | Promise<void>;

/**
 * Загруженное расширение
 */
export interface LoadedExtension {
  name: string;
  path: string;
  scope: 'global' | 'project';
  tools: ExtensionToolDefinition[];
  eventHandlerIds: string[];
  replacedTools: Map<string, (args: any) => Promise<any>>;
  loadedAt: number;
  error?: string;
}

// ============================================================================
// Extension Manager
// ============================================================================

export class ExtensionManager {
  private extensions = new Map<string, LoadedExtension>();
  private registeredTools = new Map<string, ExtensionToolDefinition>();
  private toolReplacements = new Map<string, (args: any) => Promise<any>>();
  private projectPath: string;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
  }
  
  /**
   * Discovery и загрузка всех расширений
   */
  async loadAll(): Promise<LoadedExtension[]> {
    const results: LoadedExtension[] = [];
    
    // 1. Глобальные расширения: ~/.m7/extensions/
    const globalDir = path.join(homedir(), '.m7', 'extensions');
    const globalExts = await this.discoverExtensions(globalDir, 'global');
    
    for (const ext of globalExts) {
      const loaded = await this.loadExtension(ext.path, ext.name, 'global');
      results.push(loaded);
    }
    
    // 2. Проектные расширения: .m7/extensions/
    const projectDir = path.join(this.projectPath, '.m7', 'extensions');
    const projectExts = await this.discoverExtensions(projectDir, 'project');
    
    for (const ext of projectExts) {
      const loaded = await this.loadExtension(ext.path, ext.name, 'project');
      results.push(loaded);
    }
    
    const successCount = results.filter(e => !e.error).length;
    const failCount = results.filter(e => e.error).length;
    
    if (results.length > 0) {
      log.info(`Extensions loaded: ${successCount} ok, ${failCount} failed (${results.length} total)`);
    }
    
    return results;
  }
  
  /**
   * Найти файлы расширений в директории
   */
  private async discoverExtensions(
    dir: string, 
    scope: 'global' | 'project'
  ): Promise<Array<{ name: string; path: string }>> {
    const found: Array<{ name: string; path: string }> = [];
    
    try {
      await fs.access(dir);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        
        // Поддерживаем .js и .mjs
        if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
          const name = entry.name.replace(/\.(m?js)$/, '');
          found.push({
            name,
            path: path.join(dir, entry.name)
          });
        }
      }
      
      if (found.length > 0) {
        log.info(`Discovered ${found.length} ${scope} extension(s) in ${dir}`);
      }
    } catch {
      // Directory doesn't exist — OK
    }
    
    return found;
  }
  
  /**
   * Загрузить одно расширение
   */
  async loadExtension(
    filePath: string, 
    name: string, 
    scope: 'global' | 'project'
  ): Promise<LoadedExtension> {
    const extension: LoadedExtension = {
      name,
      path: filePath,
      scope,
      tools: [],
      eventHandlerIds: [],
      replacedTools: new Map(),
      loadedAt: Date.now()
    };
    
    try {
      // Проверяем файл
      await fs.access(filePath);
      
      // Создаём API для расширения
      const api = this.createAPI(extension);
      
      // Импортируем модуль
      const fileUrl = `file://${filePath}?t=${Date.now()}`;
      const module = await import(fileUrl);
      
      // Получаем функцию расширения
      const extensionFn: ExtensionFunction = module.default || module;
      
      if (typeof extensionFn !== 'function') {
        throw new Error(`Extension ${name} does not export a function`);
      }
      
      // Выполняем расширение
      await extensionFn(api);
      
      // Регистрируем
      this.extensions.set(name, extension);
      
      log.info(`Extension "${name}" loaded (${scope}): ${extension.tools.length} tool(s)`);
      
    } catch (err: any) {
      extension.error = err.message;
      log.error(`Failed to load extension "${name}":`, err.message);
    }
    
    return extension;
  }
  
  /**
   * Создать API для расширения
   */
  private createAPI(extension: LoadedExtension): M7ExtensionAPI {
    const extLog = createLogger(`[Ext:${extension.name}]`);
    
    return {
      registerTool: (tool: ExtensionToolDefinition) => {
        // Проверяем уникальность имени (с префиксом)
        const fullName = `ext_${extension.name}_${tool.name}`;
        const wrappedTool: ExtensionToolDefinition = {
          ...tool,
          name: fullName
        };
        
        extension.tools.push(wrappedTool);
        this.registeredTools.set(fullName, wrappedTool);
        
        extLog.info(`Tool registered: ${fullName}`);
      },
      
      replaceTool: (name: string, handler: (args: any) => Promise<any>) => {
        extension.replacedTools.set(name, handler);
        this.toolReplacements.set(name, handler);
        
        extLog.info(`Tool replaced: ${name}`);
      },
      
      on: (event: M7Event, handler: EventHandler): string => {
        const id = eventOn(event, handler);
        extension.eventHandlerIds.push(id);
        return id;
      },
      
      off: (event: M7Event, handlerId: string) => {
        eventOff(event, handlerId);
        const idx = extension.eventHandlerIds.indexOf(handlerId);
        if (idx !== -1) extension.eventHandlerIds.splice(idx, 1);
      },
      
      getConfig: () => ({
        projectPath: this.projectPath,
        m7Path: path.join(this.projectPath, '.m7'),
        version: '3.10.3'
      }),
      
      memory: {
        store: async (content: string, _level?: string): Promise<string> => {
          // Lazy import чтобы не создавать циклические зависимости
          try {
            const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
            const core = await getMemoryCore();
            const result = await core.store(content, {
              source: 'code_analysis',
              contextKeys: [`ext:${extension.name}`],
              confidence: 0.7
            });
            return result.id;
          } catch (err: any) {
            extLog.error(`Memory store failed: ${err.message}`);
            return '';
          }
        },
        
        search: async (query: string): Promise<any[]> => {
          try {
            const { getMemoryCore } = await import('../../memory/auto/unified-memory-core.js');
            const core = await getMemoryCore();
            const results = await core.cascadeSearch(query, { limit: 10 });
            return results;
          } catch (err: any) {
            extLog.error(`Memory search failed: ${err.message}`);
            return [];
          }
        }
      },
      
      log: {
        info: (...args: unknown[]) => extLog.info(String(args[0]), ...args.slice(1)),
        warn: (...args: unknown[]) => extLog.warn(String(args[0]), ...args.slice(1)),
        error: (...args: unknown[]) => extLog.error(String(args[0]), ...args.slice(1)),
        debug: (...args: unknown[]) => extLog.debug(String(args[0]), ...args.slice(1))
      }
    };
  }
  
  /**
   * Выгрузить расширение
   */
  async unloadExtension(name: string): Promise<boolean> {
    const extension = this.extensions.get(name);
    if (!extension) return false;
    
    // Удаляем event handlers
    for (const handlerId of extension.eventHandlerIds) {
      // Remove from all events (simplified)
      const emitter = getEventEmitter();
      // We can't easily remove without knowing the event, so we just note it
      log.info(`Handler ${handlerId} should be removed`);
    }
    
    // Удаляем tools
    for (const tool of extension.tools) {
      this.registeredTools.delete(tool.name);
    }
    
    // Удаляем replacements
    for (const [toolName] of extension.replacedTools) {
      this.toolReplacements.delete(toolName);
    }
    
    this.extensions.delete(name);
    log.info(`Extension "${name}" unloaded`);
    
    return true;
  }
  
  /**
   * Получить все загруженные расширения
   */
  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.extensions.values());
  }
  
  /**
   * Получить все зарегистрированные инструменты расширений
   */
  getExtensionTools(): ExtensionToolDefinition[] {
    return Array.from(this.registeredTools.values());
  }
  
  /**
   * Получить замену для инструмента (если есть)
   */
  getToolReplacement(name: string): ((args: any) => Promise<any>) | undefined {
    return this.toolReplacements.get(name);
  }
  
  /**
   * Получить статистику
   */
  getStats(): {
    total: number;
    global: number;
    project: number;
    tools: number;
    replacements: number;
    errors: number;
  } {
    const exts = Array.from(this.extensions.values());
    return {
      total: exts.length,
      global: exts.filter(e => e.scope === 'global').length,
      project: exts.filter(e => e.scope === 'project').length,
      tools: this.registeredTools.size,
      replacements: this.toolReplacements.size,
      errors: exts.filter(e => e.error).length
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let manager: ExtensionManager | null = null;

export function getExtensionManager(projectPath?: string): ExtensionManager {
  if (!manager) {
    manager = new ExtensionManager(projectPath);
  }
  return manager;
}

export function resetExtensionManager(): void {
  manager = null;
}
