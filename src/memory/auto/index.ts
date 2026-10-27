import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[AutoMemory]');
/**
 * M7 v3.0 - Auto Memory System
 * 
 * Автоматическая система памяти с мультипроектной поддержкой
 */

import * as path from 'path';
import { PersistentMemory, createPersistentMemory, IndexReport } from './unified-memory-core.js';
import { ProjectRegistry, getProjectRegistry } from './project-registry.js';
import { ContextInjector } from './context-injector.js';
import {
  ProjectInfo,
  EnrichedContext,
  ContextInjectionConfig,
  MultiProjectStats,
  DEFAULT_CONTEXT_INJECTION_CONFIG,
  DEFAULT_COLLECTION_POOL_CONFIG,
} from './types.js';

// Re-export types
export * from './types.js';
export { ProjectRegistry, getProjectRegistry } from './project-registry.js';
export { ContextInjector } from './context-injector.js';

/**
 * Pooled memory instance
 */
interface PooledMemory {
  memory: PersistentMemory;
  projectId: string;
  lastAccessed: Date;
  accessCount: number;
}

/**
 * MemoryManager - Singleton для управления памятью
 */
export class MemoryManager {
  private static instance: MemoryManager | null = null;
  
  private registry: ProjectRegistry;
  private contextInjector: ContextInjector;
  private pool: Map<string, PooledMemory> = new Map();
  private activeProjectId: string | null = null;
  
  private config = {
    maxPoolSize: DEFAULT_COLLECTION_POOL_CONFIG.maxSize,
    poolTtlMs: DEFAULT_COLLECTION_POOL_CONFIG.ttlMs,
    chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
  };
  
  private stats = {
    totalQueries: 0,
    projectSwitches: 0,
    cacheEvictions: 0,
  };

  // v9.1: Store timer ref for cleanup + .unref() to not keep process alive
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.registry = getProjectRegistry();
    this.contextInjector = new ContextInjector();
    
    // Периодическая очистка неактивных
    // v9.2: disposed guard — callback может быть в очереди event loop после dispose()
    this.evictionTimer = setInterval(() => {
      if (!MemoryManager.instance) return;
      this.evictInactive();
    }, 5 * 60 * 1000);
    if (this.evictionTimer && typeof this.evictionTimer === 'object' && 'unref' in this.evictionTimer) {
      (this.evictionTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Получить singleton instance
   */
  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Сбросить singleton (для тестов)
   */
  static resetInstance(): void {
    if (MemoryManager.instance) {
      MemoryManager.instance.dispose();
      MemoryManager.instance = null;
    }
  }

  // ============================================================================
  // Project Management
  // ============================================================================

  /**
   * Установить активный проект
   */
  async setActiveProject(projectPath: string): Promise<ProjectInfo> {
    const project = await this.registry.getOrCreate(projectPath);
    
    if (this.activeProjectId !== project.id) {
      this.stats.projectSwitches++;
      this.activeProjectId = project.id;
      
      // Предзагрузить память для быстрого доступа
      await this.getProjectMemory(project.id);
    }
    
    return project;
  }

  /**
   * Получить активный проект
   */
  async getActiveProject(): Promise<ProjectInfo | null> {
    if (!this.activeProjectId) return null;
    return this.registry.getById(this.activeProjectId);
  }

  /**
   * Получить ID активного проекта
   */
  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  /**
   * Список всех проектов
   */
  async listProjects(): Promise<ProjectInfo[]> {
    return this.registry.list();
  }

  // ============================================================================
  // Memory Access
  // ============================================================================

  /**
   * Получить память для проекта
   */
  async getProjectMemory(projectId?: string): Promise<PersistentMemory> {
    const id = projectId || this.activeProjectId;
    
    if (!id) {
      throw new Error('No active project. Call setActiveProject first.');
    }

    // Проверить пул
    const pooled = this.pool.get(id);
    if (pooled) {
      pooled.lastAccessed = new Date();
      pooled.accessCount++;
      return pooled.memory;
    }

    // Загрузить из registry
    const project = await this.registry.getById(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    // Проверить размер пула
    if (this.pool.size >= this.config.maxPoolSize) {
      this.evictLRU();
    }

    // Создать новый instance
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    const memory = new PersistentMemory({
      openaiApiKey: openaiKey,
      defaultProjectId: id,
      chromaUrl: this.config.chromaUrl,
      collectionName: project.collectionName,
      embeddingModel: 'text-embedding-3-small',
    });

    await memory.initialize();

    // Добавить в пул
    this.pool.set(id, {
      memory,
      projectId: id,
      lastAccessed: new Date(),
      accessCount: 1,
    });

    return memory;
  }

  // ============================================================================
  // Context Injection
  // ============================================================================

  /**
   * Обогатить контекст для запроса
   */
  async enrichContext(query: string, projectId?: string): Promise<EnrichedContext> {
    const id = projectId || this.activeProjectId;
    
    if (!id) {
      return {
        originalQuery: query,
        relevantChunks: [],
        projectInfo: { id: '', name: '', technologies: [], patterns: [] },
        assembledContext: '',
        tokenCount: 0,
        searchDuration: 0,
        source: 'search',
      };
    }

    this.stats.totalQueries++;

    const project = await this.registry.getById(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    const memory = await this.getProjectMemory(id);
    return this.contextInjector.inject(query, memory, project);
  }

  /**
   * Проверить, нужен ли injection
   */
  shouldInject(trigger: 'analyzeTask' | 'hiveCoordinator' | 'session'): boolean {
    return this.contextInjector.shouldInject(trigger);
  }

  /**
   * Обновить конфигурацию context injection
   */
  updateContextConfig(config: Partial<ContextInjectionConfig>): void {
    this.contextInjector.updateConfig(config);
  }

  // ============================================================================
  // Indexing
  // ============================================================================

  /**
   * Индексировать проект
   */
  async indexProject(projectPath?: string): Promise<IndexReport> {
    const targetPath = projectPath || (this.activeProjectId 
      ? (await this.registry.getById(this.activeProjectId))?.path 
      : null);

    if (!targetPath) {
      throw new Error('No project path specified and no active project');
    }

    const project = await this.registry.getOrCreate(targetPath);
    const memory = await this.getProjectMemory(project.id);
    
    const report = await memory.indexDirectory(targetPath);
    
    // Обновить статус в registry
    await this.registry.updateIndexStatus(project.id, 'complete', {
      fileCount: report.indexed,
      chunkCount: report.indexed, // Примерно
    });

    return report;
  }

  /**
   * Инкрементальная индексация
   */
  async indexIncremental(changedFiles: string[], projectId?: string): Promise<IndexReport> {
    const id = projectId || this.activeProjectId;
    if (!id) {
      throw new Error('No active project');
    }

    const memory = await this.getProjectMemory(id);
    const project = await this.registry.getById(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    // Индексируем только изменённые файлы
    const entries = [];
    for (const filePath of changedFiles) {
      try {
        const fs = await import('fs/promises');
        const content = await fs.readFile(filePath, 'utf-8');
        entries.push({
          content,
          metadata: {
            type: 'code' as const,
            source: filePath,
            language: this.detectLanguage(filePath),
            tags: ['incremental'],
            importance: 0.7,
          },
        });
      } catch {
        // Файл может быть удалён
      }
    }

    if (entries.length > 0) {
      await memory.addBatch(entries);
    }

    return {
      indexed: entries.length,
      skipped: changedFiles.length - entries.length,
      errors: [],
      duration: 0,
      totalTokens: 0,
    };
  }

  // ============================================================================
  // v3.6: File-level Reindexing (for File Watcher)
  // ============================================================================

  /**
   * v3.6: Reindex a single file in ChromaDB
   * Called by file watcher when a file changes
   */
  async reindexFile(filePath: string): Promise<void> {
    if (!this.activeProjectId) {
      log.debug('M7 v3.6] Cannot reindex: no active project');
      return;
    }

    const pooled = this.pool.get(this.activeProjectId);
    if (!pooled?.memory) {
      log.debug('M7 v3.6] Cannot reindex: no memory instance');
      return;
    }

    try {
      const fs = await import('fs/promises');
      
      // 1. Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      
      // 2. Delete existing chunks for this file
      await this.removeFromIndex(filePath);
      
      // 3. Chunk the content
      const chunks = this.chunkFileContent(content, filePath);
      
      if (chunks.length === 0) {
        log.debug(`M7 v3.6] File ${filePath} produced no chunks, skipping`);
        return;
      }
      
      // 4. Add chunks to ChromaDB
      const entries = chunks.map((chunk, i) => ({
        content: chunk,
        metadata: {
          source: filePath,
          projectId: this.activeProjectId!,
          type: 'code' as const,
          language: this.detectLanguage(filePath),
          tags: ['indexed', 'auto-reindex', `chunk_${i + 1}_of_${chunks.length}`],
          importance: 0.6,
        }
      }));
      
      await pooled.memory.addBatch(entries);
      
      log.debug(`M7 v3.6] Reindexed ${filePath}: ${chunks.length} chunks`);
      
    } catch (error: any) {
      // File might be deleted or unreadable - not fatal
      if (error.code !== 'ENOENT') {
        log.debug(`M7 v3.6] Reindex failed for ${filePath}: ${error.message}`);
      }
    }
  }

  /**
   * v3.6: Remove a file from ChromaDB index
   * Called by file watcher when a file is deleted
   */
  async removeFromIndex(filePath: string): Promise<void> {
    if (!this.activeProjectId) return;
    
    const pooled = this.pool.get(this.activeProjectId);
    if (!pooled?.memory) return;
    
    try {
      const count = await pooled.memory.deleteBySource(filePath);
      if (count > 0) {
        log.debug(`M7 v3.6] Removed from index: ${filePath} (${count} chunks)`);
      }
    } catch (error: any) {
      log.debug(`M7 v3.6] Remove failed for ${filePath}: ${error.message}`);
    }
  }

  /**
   * v3.6: Chunk file content into smaller pieces for embedding
   */
  private chunkFileContent(content: string, filePath: string): string[] {
    const lines = content.split('\n');
    const chunks: string[] = [];
    const chunkSize = 50; // lines per chunk
    const overlap = 10;
    
    // Skip empty or tiny files
    if (lines.length < 5) return [];
    
    // Skip very large files (> 2000 lines)
    if (lines.length > 2000) {
      log.debug(`M7 v3.6] File too large (${lines.length} lines), taking first 1000 lines: ${filePath}`);
      lines.splice(1000);
    }
    
    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize);
      if (chunkLines.length >= 5) { // Skip tiny chunks
        chunks.push(chunkLines.join('\n'));
      }
    }
    
    return chunks;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Получить статистику по всем проектам
   */
  async getStats(): Promise<MultiProjectStats> {
    const projects = await this.registry.list();
    const contextStats = this.contextInjector.getStats();
    
    let totalChunks = 0;
    const projectStats = [];
    
    for (const project of projects) {
      totalChunks += project.chunkCount;
      projectStats.push({
        id: project.id,
        name: project.displayName,
        chunks: project.chunkCount,
        queries: 0, // TODO: track per project
        lastAccessed: project.lastAccessed,
      });
    }

    // Estimate memory usage
    const memoryUsageMb = this.pool.size * 50; // ~50MB per loaded collection

    return {
      totalProjects: projects.length,
      activeProjects: this.pool.size,
      totalChunks,
      totalQueries: this.stats.totalQueries,
      cacheHitRate: contextStats.cacheHitRate,
      memoryUsageMb,
      savedApiCost: contextStats.cacheHits * 0.00002, // ~$0.00002 per embedding
      projects: projectStats,
    };
  }

  // ============================================================================
  // Pool Management
  // ============================================================================

  /**
   * Evict LRU (least recently used)
   */
  private evictLRU(): void {
    if (this.pool.size === 0) return;

    // Найти наименее используемый (кроме активного)
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, pooled] of this.pool) {
      if (key !== this.activeProjectId && pooled.lastAccessed.getTime() < oldestTime) {
        oldestTime = pooled.lastAccessed.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey);
      this.stats.cacheEvictions++;
    }
  }

  /**
   * Evict inactive (по TTL)
   */
  private evictInactive(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [key, pooled] of this.pool) {
      if (key !== this.activeProjectId) {
        if (now - pooled.lastAccessed.getTime() > this.config.poolTtlMs) {
          toEvict.push(key);
        }
      }
    }

    for (const key of toEvict) {
      this.pool.delete(key);
      this.stats.cacheEvictions++;
    }
  }

  /**
   * Preload часто используемых проектов
   */
  async preloadFrequent(limit: number = 3): Promise<void> {
    const frequent = await this.registry.getFrequent(limit);
    
    for (const project of frequent) {
      if (!this.pool.has(project.id) && this.pool.size < this.config.maxPoolSize) {
        try {
          await this.getProjectMemory(project.id);
        } catch {
          // Ignore preload errors
        }
      }
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.json': 'json',
      '.md': 'markdown',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Освободить ресурсы
   */
  private dispose(): void {
    // v9.1: Clear eviction timer on dispose
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    this.pool.clear();
    this.contextInjector.clearCache();
  }
}

/**
 * Получить глобальный MemoryManager
 */
export function getMemoryManager(): MemoryManager {
  return MemoryManager.getInstance();
}

