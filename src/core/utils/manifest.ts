/**
 * M7 Manifest System v3.10.1
 * 
 * Отслеживает состояние файлов проекта для инкрементального warmup.
 * Позволяет ускорить warmup в 3-5x за счёт пропуска неизменённых файлов.
 */

import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from './logger.js';
import { atomicWriteJSON, safeReadJSON } from './atomicWrite.js';
import { withRetry, DEFAULT_RETRY_CONFIG } from './retry.js';
import { getProjectPath } from './projectPath.js';

const log = createLogger('[Manifest]');

// ============================================================================
// Types
// ============================================================================

export interface FileEntry {
  /** Относительный путь к файлу */
  path: string;
  /** SHA-256 хэш содержимого */
  contentHash: string;
  /** Размер файла в байтах */
  size: number;
  /** Время последней модификации (ISO string) */
  modifiedAt: string;
  /** Время последнего warmup этого файла */
  lastWarmedAt?: string;
  /** Уровень памяти куда загружен */
  memoryLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  /** IDs записей в памяти связанных с этим файлом */
  memoryRecordIds?: string[];
}

export interface ManifestData {
  /** Версия формата манифеста */
  version: string;
  /** ID проекта */
  projectId: string;
  /** Время создания манифеста */
  createdAt: string;
  /** Время последнего обновления */
  updatedAt: string;
  /** Записи о файлах */
  files: Record<string, FileEntry>;
  /** Статистика */
  stats: {
    totalFiles: number;
    totalSize: number;
    lastFullWarmup?: string;
    warmupCount: number;
    averageWarmupTimeMs?: number;
  };
}

export interface WarmupDiff {
  /** Новые файлы, требующие warmup */
  added: FileEntry[];
  /** Изменённые файлы, требующие re-warmup */
  modified: FileEntry[];
  /** Удалённые файлы (записи нужно инвалидировать) */
  removed: string[];
  /** Неизменённые файлы (можно пропустить) */
  unchanged: string[];
}

// ============================================================================
// Manifest Manager
// ============================================================================

export class ManifestManager {
  private manifestPath: string;
  private manifest: ManifestData | null = null;
  private projectPath: string;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.manifestPath = path.join(this.projectPath, '.m7', 'manifest.json');
  }
  
  /**
   * Загрузить или создать манифест
   */
  async load(): Promise<ManifestData> {
    if (this.manifest) {
      return this.manifest;
    }
    
    const result = await safeReadJSON<ManifestData>(this.manifestPath);
    
    if (result.data && result.data.version) {
      this.manifest = result.data;
      log.info(`Loaded manifest: ${this.manifest.stats.totalFiles} files tracked`);
    } else {
      // Создаём новый манифест
      this.manifest = this.createEmptyManifest();
      log.info('Created new manifest');
    }
    
    return this.manifest;
  }
  
  /**
   * Сохранить манифест с использованием atomic write
   */
  async save(): Promise<void> {
    if (!this.manifest) {
      log.warn('No manifest to save');
      return;
    }
    
    this.manifest.updatedAt = new Date().toISOString();
    
    // Используем retry для надёжности
    await withRetry(
      async () => {
        await atomicWriteJSON(this.manifestPath, this.manifest);
      },
      {
        ...DEFAULT_RETRY_CONFIG,
        maxAttempts: 3,
        initialDelayMs: 100,
      }
    );
    
    log.debug(`Manifest saved: ${this.manifest.stats.totalFiles} files`);
  }
  
  /**
   * Вычислить diff между текущим состоянием файлов и манифестом
   */
  async computeDiff(filePaths: string[]): Promise<WarmupDiff> {
    const manifest = await this.load();
    
    const diff: WarmupDiff = {
      added: [],
      modified: [],
      removed: [],
      unchanged: [],
    };
    
    const seenPaths = new Set<string>();
    
    for (const filePath of filePaths) {
      const relativePath = path.relative(this.projectPath, filePath);
      seenPaths.add(relativePath);
      
      const existingEntry = manifest.files[relativePath];
      
      try {
        const stats = await fs.stat(filePath);
        const contentHash = await this.computeFileHash(filePath);
        
        const newEntry: FileEntry = {
          path: relativePath,
          contentHash,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
        
        if (!existingEntry) {
          // Новый файл
          diff.added.push(newEntry);
        } else if (existingEntry.contentHash !== contentHash) {
          // Изменённый файл
          newEntry.lastWarmedAt = existingEntry.lastWarmedAt;
          newEntry.memoryLevel = existingEntry.memoryLevel;
          newEntry.memoryRecordIds = existingEntry.memoryRecordIds;
          diff.modified.push(newEntry);
        } else {
          // Неизменённый файл
          diff.unchanged.push(relativePath);
        }
      } catch (err) {
        log.debug(`Cannot stat file ${filePath}:`, err);
      }
    }
    
    // Найти удалённые файлы
    for (const trackedPath of Object.keys(manifest.files)) {
      if (!seenPaths.has(trackedPath)) {
        diff.removed.push(trackedPath);
      }
    }
    
    log.info(`Diff computed: +${diff.added.length} ~${diff.modified.length} -${diff.removed.length} =${diff.unchanged.length}`);
    
    return diff;
  }
  
  /**
   * Обновить манифест после warmup файлов
   */
  async updateAfterWarmup(
    entries: FileEntry[], 
    memoryRecordIds?: Map<string, string[]>
  ): Promise<void> {
    const manifest = await this.load();
    const now = new Date().toISOString();
    
    for (const entry of entries) {
      entry.lastWarmedAt = now;
      if (memoryRecordIds?.has(entry.path)) {
        entry.memoryRecordIds = memoryRecordIds.get(entry.path);
      }
      manifest.files[entry.path] = entry;
    }
    
    // Обновляем статистику
    manifest.stats.totalFiles = Object.keys(manifest.files).length;
    manifest.stats.totalSize = Object.values(manifest.files)
      .reduce((sum, f) => sum + f.size, 0);
    manifest.stats.warmupCount++;
    
    await this.save();
  }
  
  /**
   * Удалить записи о файлах из манифеста
   */
  async removeFiles(paths: string[]): Promise<string[]> {
    const manifest = await this.load();
    const removedRecordIds: string[] = [];
    
    for (const filePath of paths) {
      const entry = manifest.files[filePath];
      if (entry?.memoryRecordIds) {
        removedRecordIds.push(...entry.memoryRecordIds);
      }
      delete manifest.files[filePath];
    }
    
    manifest.stats.totalFiles = Object.keys(manifest.files).length;
    manifest.stats.totalSize = Object.values(manifest.files)
      .reduce((sum, f) => sum + f.size, 0);
    
    await this.save();
    
    return removedRecordIds;
  }
  
  /**
   * Получить статистику экономии от incremental warmup
   */
  getWarmupSavings(diff: WarmupDiff): {
    filesSkipped: number;
    bytesSkipped: number;
    estimatedTimeSavedMs: number;
    speedupFactor: number;
  } {
    const manifest = this.manifest!;
    
    const skippedFiles = diff.unchanged.length;
    const totalFiles = skippedFiles + diff.added.length + diff.modified.length;
    
    const skippedBytes = diff.unchanged
      .map(p => manifest.files[p]?.size || 0)
      .reduce((sum, s) => sum + s, 0);
    
    // Примерная оценка: 10ms на файл
    const avgTimePerFile = manifest.stats.averageWarmupTimeMs || 10;
    const estimatedTimeSaved = skippedFiles * avgTimePerFile;
    
    const speedupFactor = totalFiles > 0 
      ? totalFiles / Math.max(1, totalFiles - skippedFiles)
      : 1;
    
    return {
      filesSkipped: skippedFiles,
      bytesSkipped: skippedBytes,
      estimatedTimeSavedMs: estimatedTimeSaved,
      speedupFactor: Math.round(speedupFactor * 10) / 10,
    };
  }
  
  /**
   * Записать время warmup для улучшения оценок
   */
  async recordWarmupTime(durationMs: number, fileCount: number): Promise<void> {
    const manifest = await this.load();
    
    const currentAvg = manifest.stats.averageWarmupTimeMs || 10;
    const newAvg = fileCount > 0 ? durationMs / fileCount : currentAvg;
    
    // Экспоненциальное сглаживание
    manifest.stats.averageWarmupTimeMs = Math.round(
      currentAvg * 0.7 + newAvg * 0.3
    );
    
    await this.save();
  }
  
  /**
   * Пометить полный warmup выполненным
   */
  async markFullWarmup(): Promise<void> {
    const manifest = await this.load();
    manifest.stats.lastFullWarmup = new Date().toISOString();
    await this.save();
  }
  
  /**
   * Проверить нужен ли полный warmup
   */
  async needsFullWarmup(maxAgeHours: number = 24): Promise<boolean> {
    const manifest = await this.load();
    
    if (!manifest.stats.lastFullWarmup) {
      return true;
    }
    
    const lastFull = new Date(manifest.stats.lastFullWarmup).getTime();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    
    return Date.now() - lastFull > maxAgeMs;
  }
  
  /**
   * Вычислить SHA-256 хэш файла
   */
  private async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
  
  /**
   * Создать пустой манифест
   */
  private createEmptyManifest(): ManifestData {
    return {
      version: '1.0.0',
      projectId: path.basename(this.projectPath),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: {},
      stats: {
        totalFiles: 0,
        totalSize: 0,
        warmupCount: 0,
      },
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let manifestManager: ManifestManager | null = null;

export function getManifestManager(projectPath?: string): ManifestManager {
  if (!manifestManager) {
    manifestManager = new ManifestManager(projectPath);
  }
  return manifestManager;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Быстрая проверка: изменился ли файл?
 */
export async function hasFileChanged(
  filePath: string,
  projectPath?: string
): Promise<boolean> {
  const manager = getManifestManager(projectPath);
  const manifest = await manager.load();
  
  const relativePath = path.relative(
    projectPath || getProjectPath(),
    filePath
  );
  
  const entry = manifest.files[relativePath];
  if (!entry) {
    return true; // Новый файл
  }
  
  try {
    const stats = await fs.stat(filePath);
    // Быстрая проверка по времени модификации
    if (entry.modifiedAt !== stats.mtime.toISOString()) {
      return true;
    }
    // Проверка по размеру
    if (entry.size !== stats.size) {
      return true;
    }
  } catch {
    return true; // Файл не существует или ошибка
  }
  
  return false;
}

/**
 * Пакетная проверка изменений
 */
export async function getChangedFiles(
  filePaths: string[],
  projectPath?: string
): Promise<string[]> {
  const changed: string[] = [];
  
  for (const filePath of filePaths) {
    if (await hasFileChanged(filePath, projectPath)) {
      changed.push(filePath);
    }
  }
  
  return changed;
}
