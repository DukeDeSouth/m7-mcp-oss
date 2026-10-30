import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[Memory]');
import path from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../core/utils/atomicWrite.js';
import { BoundedMap } from '../core/utils/boundedMap.js';
import { normalizeFogEntry, type BoundaryStatus } from './fogBoundary.js';

export type { BoundaryStatus };

export interface ProjectMemory {
  name: string;
  description: string;
  purpose: string;
  mainTechnologies: string[];
  architecture: string;
  keyFeatures: string[];
  businessDomain: string;
  lastUpdated: Date;
}

export interface FogOfWarEntry {
  id: string;
  path: string;
  discovery: string;
  technical_details: any;
  dependencies: string[];
  discovered_at: Date;
  invalidated_at?: Date;
  confidence: number; // 0-1
  source: 'code_analysis' | 'runtime' | 'documentation' | 'experiment' | 'human';
  boundary_status?: BoundaryStatus;
  blocking?: boolean;
}

export interface MemoryLevel {
  surface: Map<string, any>;      // Текущая сессия
  working: Map<string, any>;      // Активная задача
  longterm: Map<string, any>;     // Паттерны проекта
  conceptual: Map<string, any>;   // Абстрактные знания
  project: ProjectMemory;         // О чем проект (новый уровень)
}

export class MemorySystem {
  private static readonly DEFAULT_CAPS = {
    longterm: 2000,
    conceptual: 1000,
  } as const;

  private storage: MemoryLevel;
  private fogOfWar: Map<string, FogOfWarEntry>;
  private dataPath: string;
  /** MEM-4: entry count loaded from disk per persisted level */
  private loadedEntryCount: Partial<Record<'longterm' | 'conceptual', number>> = {};
  /** MEM-4: explicit deletes since last load (for persist guard) */
  private explicitDeletes: Partial<Record<'longterm' | 'conceptual', number>> = {};
  
  // v3.9: Batched writes with debounce
  private pendingWrites: Map<string, { level: string; data: any }> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_DELAY_MS = 1000; // 1 second debounce
  private readonly MAX_PENDING_WRITES = 50; // Force flush if too many pending
  private isInitialized: boolean = false;
  private loadPromise: Promise<void> | null = null;

  constructor(projectPath?: string) {
    // Используем проектную папку .m7/ вместо глобальной ~/.m7-mcp
    const basePath = projectPath || getProjectPath();
    this.dataPath = path.join(basePath, '.m7');
    
    // v9.1: Use BoundedMap to prevent unbounded memory growth in long sessions
    this.storage = {
      surface: new BoundedMap(100),
      working: new BoundedMap(500),
      longterm: new BoundedMap(2000),
      conceptual: new BoundedMap(1000),
      project: this.initializeProjectMemory()
    };
    this.fogOfWar = new BoundedMap(500);
    // v3.15: Store promise so callers can await load completion
    this.loadPromise = this.loadPersistedMemory();
  }

  /**
   * v3.15: Wait for persisted memory to finish loading.
   * Must be called before any read operations to avoid race conditions.
   */
  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
      this.loadPromise = null;
    }
  }
  
  /**
   * v3.9: Schedule a debounced flush of pending writes
   */
  private scheduleFlush(): void {
    // Force immediate flush if too many pending writes
    if (this.pendingWrites.size >= this.MAX_PENDING_WRITES) {
      this.flushPendingWrites();
      return;
    }
    
    // Debounce: cancel existing timer and set new one
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.flushTimer = setTimeout(() => {
      this.flushPendingWrites();
    }, this.FLUSH_DELAY_MS);
  }
  
  /**
   * v3.9: Flush all pending writes to disk
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.pendingWrites.size === 0) return;
    
    const writes = new Map(this.pendingWrites);
    this.pendingWrites.clear();
    
    // Group by level for batch persistence
    const levelWrites = new Map<string, number>();
    
    for (const [key, { level }] of writes) {
      levelWrites.set(level, (levelWrites.get(level) || 0) + 1);
    }
    
    // Persist each level that has changes
    const persistPromises: Promise<void>[] = [];
    
    for (const level of levelWrites.keys()) {
      if (level === 'longterm' || level === 'conceptual') {
        persistPromises.push(this.persistLevel(level));
      }
    }
    
    if (persistPromises.length > 0) {
      try {
        await Promise.all(persistPromises);
        log.debug(`MemorySystem] ✓ Flushed ${writes.size} writes to ${persistPromises.length} level(s)`);
      } catch (err) {
        log.warn(`MemorySystem] Batch flush partial failure:`, err instanceof Error ? err.message : 'Unknown');
      }
    }
  }
  
  /**
   * v3.9: Force flush before shutdown
   */
  async shutdown(): Promise<void> {
    await this.flushPendingWrites();
  }

  private initializeProjectMemory(): ProjectMemory {
    return {
      name: 'Unknown Project',
      description: 'Project description not yet discovered',
      purpose: 'Purpose not yet identified',
      mainTechnologies: [],
      architecture: 'Architecture not yet mapped',
      keyFeatures: [],
      businessDomain: 'Domain not yet identified',
      lastUpdated: new Date()
    };
  }

  private resizeStorageCap(level: 'longterm' | 'conceptual', minFromFile: number): void {
    const map = this.storage[level];
    const floor = MemorySystem.DEFAULT_CAPS[level];
    // Headroom +1 so a single store after load does not evict a loaded row (MEM-4 acceptance)
    const target =
      minFromFile > 0
        ? Math.max(floor, minFromFile + 1)
        : floor;
    if (map instanceof BoundedMap && target > map.capacity) {
      map.setMaxSize(target);
    }
  }

  private async loadPersistedMemory() {
    try {
      // v3.10: Use safe read with automatic backup recovery
      
      // Load project memory
      const projectPath = `${this.dataPath}/memory/project.json`;
      const projectResult = await safeReadJSON<ProjectMemory>(projectPath);
      if (projectResult.data) {
        this.storage.project = projectResult.data;
        if (projectResult.recoveredFrom) {
          log.warn(`Project memory recovered from backup: ${projectResult.recoveredFrom}`);
        }
      }

      // Load fog of war
      const fogPath = `${this.dataPath}/memory/fog_of_war.json`;
      const fogResult = await safeReadJSON<FogOfWarEntry[]>(fogPath);
      if (fogResult.data) {
        // v9.1: Preserve BoundedMap — clear and repopulate instead of replacing
        this.fogOfWar.clear();
        for (const e of fogResult.data) {
          this.fogOfWar.set(e.path, normalizeFogEntry(e));
        }
        if (fogResult.recoveredFrom) {
          log.warn(`Fog of war recovered from backup: ${fogResult.recoveredFrom}`);
        }
      }

      // Load other levels
      for (const level of ['longterm', 'conceptual'] as const) {
        const levelPath = `${this.dataPath}/memory/${level}.json`;
        const levelResult = await safeReadJSON<Record<string, any>>(levelPath);
        if (levelResult.data) {
          this.explicitDeletes[level] = 0;
          const entries = levelResult.data;
          const n = Object.keys(entries).length;
          this.resizeStorageCap(level, n);
          this.storage[level].clear();
          for (const [k, v] of Object.entries(entries)) {
            this.storage[level].set(k, v);
          }
          this.loadedEntryCount[level] = n;
          if (n > MemorySystem.DEFAULT_CAPS[level]) {
            log.info(
              `MemorySystem] ${level} loaded ${n} entries (above default cap ${MemorySystem.DEFAULT_CAPS[level]})`
            );
          }
          if (levelResult.recoveredFrom) {
            log.warn(`${level} memory recovered from backup: ${levelResult.recoveredFrom}`);
          }
        }
      }
      
      this.isInitialized = true;
    } catch (error) {
      log.error('Failed to load persisted memory:', error);
    }
  }

  async updateProjectMemory(updates: Partial<ProjectMemory>) {
    this.storage.project = {
      ...this.storage.project,
      ...updates,
      lastUpdated: new Date()
    };
    await this.persistProjectMemory();
  }

  async discoverTechnicalDetail(path: string, discovery: FogOfWarEntry) {
    // Check if we already know this
    const existing = this.fogOfWar.get(path);
    
    if (existing && existing.confidence >= discovery.confidence) {
      // Only update if new discovery is more confident
      return;
    }

    const normalized = normalizeFogEntry({
      ...discovery,
      discovered_at: new Date(),
    });

    // Add to fog of war
    this.fogOfWar.set(path, normalized);

    // If this invalidates other discoveries, mark them
    if (discovery.dependencies) {
      for (const dep of discovery.dependencies) {
        const depEntry = this.fogOfWar.get(dep);
        if (depEntry && !depEntry.invalidated_at) {
          // Check if this discovery conflicts
          if (this.checkConflict(depEntry, discovery)) {
            depEntry.invalidated_at = new Date();
          }
        }
      }
    }

    await this.persistFogOfWar();
  }

  private checkConflict(existing: FogOfWarEntry, newEntry: FogOfWarEntry): boolean {
    // Simple conflict detection - can be made more sophisticated
    if (existing.path === newEntry.path) {
      return existing.discovery !== newEntry.discovery;
    }
    return false;
  }

  async getFogOfWar(filter?: {
    path?: string;
    source?: FogOfWarEntry['source'];
    minConfidence?: number;
    includeInvalidated?: boolean;
  }): Promise<FogOfWarEntry[]> {
    let entries = Array.from(this.fogOfWar.values());
    
    if (filter) {
      if (filter.path !== undefined && filter.path !== null) {
        entries = entries.filter(e => e.path.includes(filter.path as string));
      }
      if (filter.source !== undefined) {
        entries = entries.filter(e => e.source === filter.source);
      }
      if (filter.minConfidence !== undefined && filter.minConfidence !== null) {
        const minConf = filter.minConfidence;
        entries = entries.filter(e => e.confidence >= minConf);
      }
      if (!filter.includeInvalidated) {
        entries = entries.filter(e => !e.invalidated_at);
      }
    }
    
    return entries.sort((a, b) => b.confidence - a.confidence);
  }

  async store(key: string, data: any, level: string = 'surface'): Promise<void> {
    if (level === 'project') {
      await this.updateProjectMemory(data);
      return;
    }

    const levelKey = `${level}:${key}`;
    
    if (level in this.storage && level !== 'project') {
      this.storage[level as keyof Omit<MemoryLevel, 'project'>].set(key, {
        data,
        timestamp: new Date(),
        level
      });

      // v3.9: Batch writes for longterm and conceptual (instead of immediate persist)
      if (level === 'longterm' || level === 'conceptual') {
        this.pendingWrites.set(levelKey, { level, data });
        this.scheduleFlush();
      }
    }
  }

  async retrieve(key: string, level: string = 'surface'): Promise<any> {
    await this.ensureLoaded();
    if (level === 'project') {
      return this.storage.project;
    }

    // Check specific level first
    if (level in this.storage && level !== 'project') {
      const levelStorage = this.storage[level as keyof Omit<MemoryLevel, 'project'>];
      if (levelStorage.has(key)) {
        return levelStorage.get(key)?.data;
      }
    }

    // If not found, check fog of war
    const fogEntry = this.fogOfWar.get(key);
    if (fogEntry && !fogEntry.invalidated_at) {
      return fogEntry;
    }

    return null;
  }

  async search(query: string, options?: {
    levels?: string[];
    includeFogOfWar?: boolean;
    minConfidence?: number;
  }): Promise<any[]> {
    await this.ensureLoaded();
    const results: any[] = [];
    const searchLevels = options?.levels || ['surface', 'working', 'longterm', 'conceptual'];
    
    // Search memory levels
    for (const level of searchLevels) {
      if (level in this.storage && level !== 'project') {
        const levelStorage = this.storage[level as keyof Omit<MemoryLevel, 'project'>];
        for (const [key, value] of levelStorage) {
          if (key.includes(query) || JSON.stringify(value).includes(query)) {
            results.push({
              ...value,
              _key: key,
              _level: level
            });
          }
        }
      }
    }

    // Search project memory
    if (searchLevels.includes('project')) {
      const projectStr = JSON.stringify(this.storage.project);
      if (projectStr.includes(query)) {
        results.push({
          ...this.storage.project,
          _level: 'project'
        });
      }
    }

    // Search fog of war
    if (options?.includeFogOfWar) {
      const fogResults = await this.getFogOfWar({
        minConfidence: options.minConfidence || 0
      });
      
      for (const entry of fogResults) {
        if (JSON.stringify(entry).includes(query)) {
          results.push({
            ...entry,
            _level: 'fog_of_war'
          });
        }
      }
    }

    return results;
  }

  async delete(key: string, level: string = 'longterm'): Promise<boolean> {
    await this.ensureLoaded();

    if (level in this.storage && level !== 'project') {
      const levelStorage = this.storage[level as keyof Omit<MemoryLevel, 'project'>];
      const existed = levelStorage.has(key);
      if (existed) {
        levelStorage.delete(key);
        if (level === 'longterm' || level === 'conceptual') {
          this.explicitDeletes[level] = (this.explicitDeletes[level] ?? 0) + 1;
        }
        // Cancel pending write for this key to prevent race condition
        this.pendingWrites.delete(`${level}:${key}`);
        // Immediate persist — not debounced
        await this.persistLevel(level);
      }
      return existed;
    }
    return false;
  }

  async reload(): Promise<void> {
    await this.flushPendingWrites();
    await this.loadPersistedMemory();
    log.debug('MemorySystem reloaded from disk');
  }

  async list(level: string = 'surface'): Promise<string[]> {
    await this.ensureLoaded();
    if (level === 'project') {
      return Object.keys(this.storage.project);
    }
    
    if (level === 'fog_of_war') {
      return Array.from(this.fogOfWar.keys());
    }

    if (level in this.storage && level !== 'project') {
      return Array.from(this.storage[level as keyof Omit<MemoryLevel, 'project'>].keys());
    }
    
    return [];
  }

  private async persistLevel(level: string) {
    try {
      if (level === 'longterm' || level === 'conceptual') {
        const persisted = level as 'longterm' | 'conceptual';
        const loaded = this.loadedEntryCount[persisted] ?? 0;
        const deleted = this.explicitDeletes[persisted] ?? 0;
        const expectedMin = loaded - deleted;
        const map = this.storage[persisted];
        if (map.size < expectedMin) {
          log.error(
            `MemorySystem] Refusing to persist ${level}: in-memory size ${map.size} < expected ${expectedMin} (possible load truncation)`
          );
          return;
        }
      }

      const levelPath = `${this.dataPath}/memory/${level}.json`;
      const data = Object.fromEntries(
        this.storage[level as keyof Omit<MemoryLevel, 'project'>].entries()
      );
      await this.writeFile(levelPath, JSON.stringify(data, null, 2));

      if (level === 'longterm' || level === 'conceptual') {
        this.loadedEntryCount[level] = this.storage[level].size;
      }
    } catch (error) {
      log.error(`Failed to persist ${level} memory:`, error);
    }
  }

  private async persistProjectMemory() {
    try {
      const projectPath = `${this.dataPath}/memory/project.json`;
      await this.writeFile(projectPath, JSON.stringify(this.storage.project, null, 2));
    } catch (error) {
      log.error('Failed to persist project memory:', error);
    }
  }

  private async persistFogOfWar() {
    try {
      const fogPath = `${this.dataPath}/memory/fog_of_war.json`;
      const entries = Array.from(this.fogOfWar.values());
      await this.writeFile(fogPath, JSON.stringify(entries, null, 2));
    } catch (error) {
      log.error('Failed to persist fog of war:', error);
    }
  }

  // Helper methods
  private async fileExists(path: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  private async writeFile(filePath: string, data: string): Promise<void> {
    // v3.10: Use atomic write with backup rotation
    const result = await atomicWriteJSON(filePath, JSON.parse(data), {
      maxBackups: 3,
      createBackup: true,
    });
    
    if (!result.success) {
      throw new Error(`Atomic write failed: ${result.error}`);
    }
    
    if (result.backupCreated) {
      log.debug(`Memory backup created: ${result.backupPath}`);
    }
  }
} 