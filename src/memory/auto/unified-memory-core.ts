/**
 * Unified Memory Core v5.0
 * 
 * Wrapper над существующими системами памяти для унифицированного API.
 * Объединяет MemorySystem (простая JSON память) и опциональный ChromaDB.
 */

import { MemorySystem, FogOfWarEntry } from '../memorySystem.js';
import {
  applyContradictPenalties,
  collectActiveConflicts,
  getContradictDependencyIds,
  normalizeDependencySpecs,
  type DependencySpec,
  type MemoryConflictEntry,
  type MemoryRelationType,
} from '../memoryRelations.js';
import {
  buildConsolidationPlaceholder,
  makeConsolidatedRecordId,
  requiresConsolidation,
  validateConsolidation,
} from '../promotionConsolidation.js';
import path from 'path';
import { getProjectPath, onProjectPathChange } from '../../core/utils/projectPath.js';
import { createLogger } from '../../core/utils/logger.js';
import { atomicWriteJSON, safeReadJSON } from '../../core/utils/atomicWrite.js';

export type { MemoryRelationType, MemoryConflictEntry, DependencySpec } from '../memoryRelations.js';

const log = createLogger('[UnifiedMemoryCore]');

// ============================================================================
// Types
// ============================================================================

export type MemoryLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export type SourceType = 'code_analysis' | 'runtime' | 'documentation' | 'experiment' | 'human';

export type EpistemicStatus =
  | 'KNOWN'
  | 'ASSUMED'
  | 'STALE'
  | 'UNKNOWN'
  | 'HUMAN_CONFIRMED';

export interface EpistemicView {
  status: EpistemicStatus;
  storedConfidence: number;
  effectiveConfidence: number;
}

export interface ProvenanceFlags {
  isHuman: boolean;
  isRuntimeGuess: boolean;
}

export const EPISTEMIC_DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const EPISTEMIC_KNOWN_THRESHOLD = 0.8;
export const EPISTEMIC_UNKNOWN_THRESHOLD = 0.15;
export const EPISTEMIC_HUMAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EPISTEMIC_MIN_EFFECTIVE = 0.1;

// Alias for backward compatibility
export type MemorySource = SourceType;

/**
 * Memory Record - единая структура записи
 * 
 * v3.10.1: Добавлена поддержка графа зависимостей
 */
export interface MemoryRecord {
  id: string;
  content: string;
  level: MemoryLevel;
  source: SourceType;
  contextKeys: string[];
  confidence: number;
  accessCount: number;
  createdAt: Date;
  lastAccessedAt?: Date;
  invalidatedAt?: Date;
  promotedFrom?: string;
  /** Sprint 6: L2+ summary awaiting host-mediated consolidation */
  needsConsolidation?: boolean;
  /** Sprint 6: source record ID at lower tier (original retained) */
  consolidatedFrom?: string;
  
  // v3.10.1: Dependency Graph Support
  /** IDs записей, от которых эта запись зависит */
  dependencies?: string[];
  /** IDs записей, которые зависят от этой записи */
  dependents?: string[];
  /** SHA-256 хэш контента для отслеживания изменений */
  contentHash?: string;
  /** Timestamp последней валидации зависимостей */
  lastValidated?: number;
  /** Sprint 4: semantic type per dependency ID (outgoing edge) */
  dependencyRelations?: Partial<Record<string, MemoryRelationType>>;
  
  /** Legacy metadata field for backward compatibility */
  metadata: {
    type: string;
    source: string;
    tags: string[];
    importance: number;
    language?: string;
    [key: string]: any;
  };
}

/**
 * Search Result - результат поиска
 */
export interface SearchResult {
  record: MemoryRecord;
  /** @deprecated Use `record` instead */
  entry: MemoryRecord;
  score: number;
  level: MemoryLevel;
}

/**
 * Store Options
 * 
 * v3.10.1: Добавлена поддержка зависимостей
 */
export interface StoreOptions {
  level?: MemoryLevel;
  source?: SourceType;
  contextKeys?: string[];
  confidence?: number;
  /** v3.10.1: IDs записей, от которых зависит новая запись */
  dependencies?: string[];
  /** Sprint 4: semantic edge types keyed by dependency ID */
  dependencyRelations?: Record<string, MemoryRelationType>;
  /** Sprint 4: MCP-friendly array form (normalized on store) */
  dependencySpecs?: DependencySpec[];
}

/**
 * Search Options
 */
export interface SearchOptions {
  limit?: number;
  minConfidence?: number;
  confidenceThreshold?: number;
  levels?: MemoryLevel[];
  maxResults?: number;
  level?: MemoryLevel;
}

/**
 * Cascade Search Options
 */
export interface CascadeOptions {
  limit?: number;
  minConfidence?: number;
  confidenceThreshold?: number;
  levels?: MemoryLevel[];
  maxResults?: number;
}

/**
 * Level Statistics
 */
export interface LevelStats {
  level: MemoryLevel;
  recordCount: number;
  avgConfidence: number;
}

/**
 * Memory Statistics
 */
export interface MemoryStats {
  projectId: string;
  totalRecords: number;
  totalEntries: number;
  invalidatedCount: number;
  lastPromotionRun?: Date;
  levels: LevelStats[];
  byLevel: Record<MemoryLevel, number>;
  fogOfWar?: {
    totalEntries: number;
    activeEntries: number;
  };
}

/**
 * Promotion Result
 */
export interface PromotionResult {
  record: MemoryRecord;
  fromLevel: MemoryLevel;
  toLevel: MemoryLevel;
  /** Sprint 6: lower-tier record kept when L2+ uses split consolidation */
  originalId?: string;
}

// ============================================================================
// Epistemic View Layer (read-only projection over confidence + provenance)
// ============================================================================

function recordTimestampMs(value: Date | number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  return value.getTime?.() ?? fallback;
}

export function resolveProvenance(record: MemoryRecord): ProvenanceFlags {
  const tags = record.metadata?.tags ?? [];
  const type = record.metadata?.type ?? '';
  const metaSource = record.metadata?.source ?? '';

  return {
    isHuman:
      record.source === 'human'
      || type === 'human'
      || metaSource === 'human'
      || tags.includes('human-confirmed'),
    isRuntimeGuess:
      type === 'runtime-guess'
      || tags.includes('runtime-guess')
      || record.metadata?.provenance === 'mirror',
  };
}

export function getEffectiveConfidence(record: MemoryRecord, now = Date.now()): number {
  const validated = record.lastValidated
    || recordTimestampMs(record.createdAt, now);
  const validatedMs = typeof validated === 'number'
    ? validated
    : new Date(validated).getTime();
  const age = now - validatedMs;
  if (age <= 0) return record.confidence;
  const decayFactor = Math.pow(0.5, age / EPISTEMIC_DECAY_HALF_LIFE_MS);
  return record.confidence * Math.max(decayFactor, EPISTEMIC_MIN_EFFECTIVE);
}

export function getEpistemicStatus(record: MemoryRecord, now = Date.now()): EpistemicStatus {
  const stored = record.confidence ?? 0;
  const effective = getEffectiveConfidence(record, now);
  const { isHuman, isRuntimeGuess } = resolveProvenance(record);
  const contentEmpty = !record.content?.trim();

  if (isHuman && !record.invalidatedAt) {
    const createdMs = recordTimestampMs(record.createdAt, now);
    if (now - createdMs <= EPISTEMIC_HUMAN_TTL_MS) {
      return 'HUMAN_CONFIRMED';
    }
  }

  if (record.invalidatedAt) return 'STALE';
  if (stored >= EPISTEMIC_KNOWN_THRESHOLD && effective < EPISTEMIC_KNOWN_THRESHOLD) {
    return 'STALE';
  }

  if (contentEmpty) return 'UNKNOWN';
  if (effective < EPISTEMIC_UNKNOWN_THRESHOLD) return 'UNKNOWN';

  if (effective >= EPISTEMIC_KNOWN_THRESHOLD && !isRuntimeGuess) {
    return 'KNOWN';
  }

  return 'ASSUMED';
}

export function getEpistemicView(record: MemoryRecord, now = Date.now()): EpistemicView {
  return {
    status: getEpistemicStatus(record, now),
    storedConfidence: record.confidence ?? 0,
    effectiveConfidence: getEffectiveConfidence(record, now),
  };
}

// ============================================================================
// In-memory record store (for records created this session)
// ============================================================================

import { BoundedMap } from '../../core/utils/boundedMap.js';

const recordStore = new BoundedMap<string, MemoryRecord>(2000);
// Tombstones are persisted whole; a bound would drop the oldest ones from disk (MEM-5)
const deletedIds = new Set<string>();

/** MEM-0: cap trust for Markdown mirror synthesis */
export const MIRROR_MAX_CONFIDENCE = 0.6;

interface RecordIterateFilter {
  levels?: MemoryLevel[];
  minConfidence?: number;
  includeMirrors?: boolean;
  query?: string;
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Levels that flush to `.m7/memory/*.json` (MEM-1) */
const DURABLE_MEMORY_STORAGE = new Set(['longterm', 'conceptual']);

export type InvalidateResult =
  | { ok: true; record: MemoryRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'persist_failed'; error: string };

// ============================================================================
// Unified Memory Core Class
// ============================================================================

/**
 * Unified Memory Core - обёртка для унифицированного доступа к памяти
 */
export class UnifiedMemoryCore {
  private static readonly KEYED_STORAGE_LEVELS = [
    'surface',
    'working',
    'longterm',
    'conceptual',
  ] as const;

  private memorySystem: MemorySystem;
  private projectPath: string;
  private initialized = false;
  private tombstoneWrites: Promise<void> = Promise.resolve();

  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.memorySystem = new MemorySystem(this.projectPath);
  }

  private tombstonePath(): string {
    return path.join(this.projectPath, '.m7', 'memory-tombstones.json');
  }

  private async loadTombstones(): Promise<void> {
    const { data } = await safeReadJSON<{ version: 1; ids: string[] }>(
      this.tombstonePath()
    );
    if (data?.ids) {
      for (const id of data.ids) {
        deletedIds.add(id);
      }
    }
  }

  /** MEM-7: the set is read when the write starts, so the last write always has every id */
  private persistTombstones(): Promise<void> {
    const run = this.tombstoneWrites.then(async () => {
      await atomicWriteJSON(this.tombstonePath(), { version: 1, ids: [...deletedIds] });
    });
    this.tombstoneWrites = run.catch(() => {});
    return run;
  }

  /** MEM-0: L4 user records persist keyed in longterm, not ProjectMemory merge */
  private durableStorageLevel(record: MemoryRecord): string {
    if (record.level === 'L4') {
      return 'longterm';
    }
    return this.mapLevelToStorage(record.level);
  }

  private passesFilter(record: MemoryRecord, filter: RecordIterateFilter): boolean {
    if (filter.levels && !filter.levels.includes(record.level)) {
      return false;
    }
    const effective = this.applyConfidenceDecay(record);
    if (filter.minConfidence != null && effective < filter.minConfidence) {
      return false;
    }
    return true;
  }

  private async resolveRecord(
    id: string,
    opts?: { touchAccess?: boolean }
  ): Promise<MemoryRecord | null> {
    await this.initialize();
    if (deletedIds.has(id)) {
      return null;
    }

    const cached = recordStore.get(id);
    if (cached !== undefined) {
      if (opts?.touchAccess) {
        cached.accessCount++;
        cached.lastAccessedAt = new Date();
      }
      return cached;
    }

    for (const level of UnifiedMemoryCore.KEYED_STORAGE_LEVELS) {
      const data = await this.memorySystem.retrieve(id, level);
      if (
        data !== null
        && data !== undefined
        && typeof data === 'object'
        && data.content !== undefined
      ) {
        const converted = this.convertToRecord({ key: id, data, level });
        recordStore.set(id, converted);
        if (opts?.touchAccess) {
          converted.accessCount++;
          converted.lastAccessedAt = new Date();
        }
        return converted;
      }
    }
    return null;
  }

  private async *iterateRecords(
    filter: RecordIterateFilter
  ): AsyncGenerator<MemoryRecord> {
    await this.initialize();
    const seen = new Set<string>();

    for (const level of UnifiedMemoryCore.KEYED_STORAGE_LEVELS) {
      const keys = await this.memorySystem.list(level);
      for (const key of keys) {
        if (deletedIds.has(key) || seen.has(key)) continue;
        const rec = await this.resolveRecord(key, { touchAccess: false });
        if (!rec || !this.passesFilter(rec, filter)) continue;
        seen.add(key);
        yield rec;
      }
    }

    for (const rec of recordStore.values()) {
      if (deletedIds.has(rec.id) || seen.has(rec.id)) continue;
      if (!this.passesFilter(rec, filter)) continue;
      seen.add(rec.id);
      yield rec;
    }

    if (filter.includeMirrors && filter.query?.trim()) {
      for (const ref of await this.buildMirrorRecords(filter.query)) {
        if (deletedIds.has(ref.id) || seen.has(ref.id)) continue;
        if (!this.passesFilter(ref, filter)) continue;
        seen.add(ref.id);
        yield ref;
      }
    }
  }

  private async buildMirrorRecords(query: string): Promise<MemoryRecord[]> {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return [];

    const refFiles: Array<{ path: string; level: MemoryLevel }> = [
      { path: 'INDEX.md', level: 'L2' },
      { path: 'MASTER_REFERENCE.md', level: 'L3' },
      { path: 'CODING_STANDARDS.md', level: 'L3' },
      { path: 'CYCLE_REGISTRY.md', level: 'L2' },
    ];

    const records: MemoryRecord[] = [];

    for (const ref of refFiles) {
      try {
        const filePath = path.join(this.projectPath, ref.path);
        const { promises: fsp } = await import('fs');
        const content = await fsp.readFile(filePath, 'utf-8');
        const sections = content.split(/^## /m).slice(1);

        for (const section of sections) {
          const sectionLower = section.toLowerCase();
          const matchCount = queryWords.filter(w => sectionLower.includes(w)).length;
          if (matchCount === 0) continue;

          const title = section.split('\n')[0].trim();
          const snippet = section.substring(0, 300).trim();
          const id = `ref_${ref.path}_${title.substring(0, 20).replace(/\W/g, '_')}`;
          if (deletedIds.has(id)) continue;

          records.push({
            id,
            content: snippet,
            level: ref.level,
            source: 'documentation',
            contextKeys: [ref.path, title],
            confidence: MIRROR_MAX_CONFIDENCE,
            accessCount: 0,
            createdAt: new Date(),
            metadata: {
              type: 'reference_file',
              source: ref.path,
              provenance: 'mirror',
              mirrorPath: ref.path,
              tags: [ref.path],
              importance: MIRROR_MAX_CONFIDENCE,
            },
          });
        }
      } catch {
        // File missing — skip
      }
    }

    return records;
  }

  /**
   * Инициализация — ждёт загрузки persisted memory с диска
   * v3.15: Fixed race condition where getStats/search returned 0 because
   * MemorySystem.loadPersistedMemory() hadn't finished yet
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.memorySystem.ensureLoaded();
    await this.loadTombstones();
    this.initialized = true;
    log.debug('UnifiedMemoryCore initialized (memory loaded from disk)');
  }

  /**
   * Сохранить данные в память
   * Returns the created record with ID
   * 
   * v3.10.1: Поддержка графа зависимостей
   */
  async store(content: string, options?: StoreOptions): Promise<MemoryRecord> {
    await this.initialize();
    
    // v3.10.1: Вычисляем content hash
    const contentHash = this.computeContentHash(content);
    const { deps, relations } = normalizeDependencySpecs(
      options?.dependencies,
      options?.dependencySpecs ??
        (options?.dependencyRelations
          ? Object.entries(options.dependencyRelations).map(([id, relationType]) => ({
              id,
              relationType,
            }))
          : undefined)
    );
    
    const record: MemoryRecord = {
      id: generateId(),
      content,
      level: options?.level || 'L0',
      source: options?.source || 'runtime',
      contextKeys: options?.contextKeys || [],
      confidence: options?.confidence ?? 0.8,
      accessCount: 0,
      createdAt: new Date(),
      // v3.10.1: Dependency graph fields
      dependencies: deps,
      dependents: [],
      dependencyRelations: Object.keys(relations).length ? relations : undefined,
      contentHash,
      lastValidated: Date.now(),
      metadata: {
        type: options?.source || 'runtime',
        source: options?.contextKeys?.[0] || '',
        tags: options?.contextKeys || [],
        importance: options?.confidence ?? 0.8,
      },
    };
    
    // Auto-fill contextKeys if empty
    if (record.contextKeys.length === 0 && content.length > 10) {
      record.contextKeys = this.extractContextKeys(content);
    }

    // Store in in-memory map
    recordStore.set(record.id, record);
    
    // v3.10.1: Обновляем dependents у записей, от которых зависим
    if (record.dependencies?.length) {
      for (const depId of record.dependencies) {
        const depRecord = await this.resolveRecord(depId);
        if (depRecord) {
          depRecord.dependents = depRecord.dependents || [];
          if (!depRecord.dependents.includes(record.id)) {
            depRecord.dependents.push(record.id);
          }
        }
      }
      log.debug(`Record ${record.id} depends on: [${record.dependencies.join(', ')}]`);
    }

    // Sprint 4: explicit contradicts — downgrade both sides, no cascade
    for (const depId of getContradictDependencyIds(record)) {
      const target = await this.resolveRecord(depId);
      if (target) {
        applyContradictPenalties(record, target);
        await this.persistRecord(target);
        log.info(`Contradicts edge: ${record.id} ↔ ${depId} — confidence downgraded on both`);
      }
    }
    
    await this.persistRecord(record);
    
    return record;
  }

  /**
   * Sprint 4: active explicit contradicts in memory graph
   */
  async getActiveConflicts(): Promise<MemoryConflictEntry[]> {
    await this.initialize();
    const records: MemoryRecord[] = [];
    for await (const r of this.iterateRecords({})) {
      records.push(r);
    }
    const byId = new Map(records.map(r => [r.id, r]));
    return collectActiveConflicts(records, (id) => byId.get(id)?.confidence);
  }

  /** Sync lookup: tombstone + in-memory store only (cold ids need async get()) */
  getRecordSync(id: string): MemoryRecord | null {
    if (deletedIds.has(id)) {
      return null;
    }
    return recordStore.get(id) ?? null;
  }

  private buildPersistPayload(record: MemoryRecord): Record<string, unknown> {
    return {
      content: record.content,
      level: record.level,
      source: record.source,
      contextKeys: record.contextKeys,
      confidence: record.confidence,
      accessCount: record.accessCount,
      dependencies: record.dependencies,
      dependents: record.dependents,
      dependencyRelations: record.dependencyRelations,
      contentHash: record.contentHash,
      lastValidated: record.lastValidated,
      needsConsolidation: record.needsConsolidation,
      consolidatedFrom: record.consolidatedFrom,
      promotedFrom: record.promotedFrom,
      timestamp: record.createdAt.toISOString(),
      ...(record.invalidatedAt
        ? { invalidatedAt: record.invalidatedAt.toISOString() }
        : {}),
    };
  }

  private async persistRecord(record: MemoryRecord): Promise<void> {
    const storageLevel = this.durableStorageLevel(record);
    try {
      await this.memorySystem.store(
        record.id,
        this.buildPersistPayload(record),
        storageLevel
      );
    } catch (err) {
      log.debug('MemorySystem store fallback:', err);
    }
  }

  private async persistRecordStrict(record: MemoryRecord): Promise<void> {
    const storageLevel = this.durableStorageLevel(record);
    try {
      await this.memorySystem.store(
        record.id,
        this.buildPersistPayload(record),
        storageLevel
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Memory persist failed: ${msg}`);
    }
  }
  
  /**
   * v3.10.1: Вычислить SHA-256 хэш контента
   */
  private computeContentHash(content: string): string {
    // Simple hash for now (can be replaced with crypto.subtle.digest)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }
  
  /**
   * v3.10.1: Получить граф зависимостей записи
   */
  getDependencyGraph(recordId: string): { 
    record: MemoryRecord | null;
    dependencies: MemoryRecord[];
    dependents: MemoryRecord[];
  } {
    const record = recordStore.get(recordId);
    if (!record) {
      return { record: null, dependencies: [], dependents: [] };
    }
    
    const dependencies = (record.dependencies || [])
      .map(id => recordStore.get(id))
      .filter((r): r is MemoryRecord => r !== undefined);
    
    const dependents = (record.dependents || [])
      .map(id => recordStore.get(id))
      .filter((r): r is MemoryRecord => r !== undefined);
    
    return { record, dependencies, dependents };
  }
  
  /**
   * v3.10.1: Найти записи требующие перевалидации
   */
  async getStaleRecords(maxAge: number = 3600000): Promise<MemoryRecord[]> {
    await this.initialize();

    const now = Date.now();
    const stale: MemoryRecord[] = [];

    for await (const record of this.iterateRecords({})) {
      const lastValid = record.lastValidated || 0;
      if (now - lastValid > maxAge) {
        stale.push(record);
      }
    }

    return stale.sort((a, b) => (a.lastValidated || 0) - (b.lastValidated || 0));
  }

  /**
   * Каскадный поиск — MEM-0: single path via iterateRecords
   */
  async cascadeSearch(query: string, options?: CascadeOptions): Promise<SearchResult[]> {
    const filter: RecordIterateFilter = {
      levels: options?.levels,
      minConfidence: options?.confidenceThreshold ?? options?.minConfidence ?? 0,
      includeMirrors: Boolean(query?.trim()),
      query,
    };

    const results: SearchResult[] = [];
    for await (const record of this.iterateRecords(filter)) {
      record.accessCount++;
      record.lastAccessedAt = new Date();
      const score = this.calculateScore(query, record);
      if (score > 0.1 || query === '') {
        results.push({ record, entry: record, score, level: record.level });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = options?.maxResults ?? options?.limit ?? 10;
    await this.runPromotionCycle();
    return results.slice(0, limit);
  }

  /**
   * Semantic search на определённом уровне
   */
  async semanticSearch(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const levels = options?.level ? [options.level] : undefined;
    return this.cascadeSearch(query, {
      ...options,
      levels,
    });
  }

  /**
   * Получить запись по ID
   */
  async get(id: string): Promise<MemoryRecord | null> {
    return this.resolveRecord(id, { touchAccess: true });
  }

  /**
   * Mark a record invalidated and persist to durable storage (L2/L3). MEM-1.
   */
  async invalidate(id: string, factor = 0.3): Promise<InvalidateResult> {
    await this.initialize();
    if (deletedIds.has(id)) {
      return { ok: false, reason: 'not_found' };
    }

    const existing = await this.get(id);
    if (!existing) {
      return { ok: false, reason: 'not_found' };
    }

    const storageLevel = this.durableStorageLevel(existing);
    if (!DURABLE_MEMORY_STORAGE.has(storageLevel)) {
      return {
        ok: false,
        reason: 'persist_failed',
        error: 'Record level is not durably persisted (use L2/L3)',
      };
    }

    const snapshot = structuredClone(existing);
    const next = structuredClone(existing);
    next.confidence *= factor;
    next.invalidatedAt = new Date();
    recordStore.set(id, next);

    try {
      await this.persistRecordStrict(next);
      return { ok: true, record: next };
    } catch (e) {
      recordStore.set(id, snapshot);
      try {
        await this.persistRecord(snapshot);
      } catch {
        /* best-effort resync MemorySystem + pendingWrites */
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: 'persist_failed', error: msg };
    }
  }

  /**
   * Удалить запись по ID — из кэша И с диска
   */
  async delete(id: string): Promise<boolean> {
    await this.initialize();

    let deletedFromDisk = false;
    for (const level of UnifiedMemoryCore.KEYED_STORAGE_LEVELS) {
      if (await this.memorySystem.delete(id, level)) {
        deletedFromDisk = true;
      }
    }

    recordStore.delete(id);
    deletedIds.add(id);
    await this.persistTombstones();
    return deletedFromDisk || true;
  }

  /**
   * Query Fog of War - records with low confidence
   */
  async queryFogOfWar(minConfidence: number = 0.5): Promise<MemoryRecord[]> {
    await this.initialize();
    
    const results: MemoryRecord[] = [];
    
    // Get low-confidence in-memory records
    for (const record of recordStore.values()) {
      if (record.confidence < minConfidence && !record.invalidatedAt) {
        results.push(record);
      }
    }
    
    // Also get from MemorySystem FogOfWar
    try {
      const fogEntries = await this.memorySystem.getFogOfWar({ includeInvalidated: false });
      for (const entry of fogEntries) {
        if (entry.confidence < minConfidence) {
          results.push({
            id: entry.id,
            content: entry.discovery,
            level: 'L1',
            source: entry.source as SourceType || 'code_analysis',
            contextKeys: [entry.path],
            confidence: entry.confidence,
            accessCount: 0,
            createdAt: entry.discovered_at,
            metadata: {
              type: entry.source || 'code_analysis',
              source: entry.path,
              tags: [entry.path],
              importance: entry.confidence,
            },
          });
        }
      }
    } catch (err) {
      log.debug('FogOfWar query fallback:', err);
    }
    
    return results;
  }

  /**
   * Получить статистику памяти (deduplicated — MemorySystem is source of truth)
   */
  async getStats(): Promise<MemoryStats> {
    await this.initialize();
    
    const levelCounts: Record<MemoryLevel, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
    const levelConfidences: Record<MemoryLevel, number[]> = { L0: [], L1: [], L2: [], L3: [], L4: [] };
    let invalidatedCount = 0;
    const seenIds = new Set<string>();
    
    // 1. Count from MemorySystem (source of truth) first
    try {
      for (const level of UnifiedMemoryCore.KEYED_STORAGE_LEVELS) {
        const keys = await this.memorySystem.list(level);
        for (const key of keys) {
          if (deletedIds.has(key)) continue;
          if (seenIds.has(key)) continue;
          seenIds.add(key);
          let memLevel = this.mapStorageToLevel(level);
          try {
            const data = await this.memorySystem.retrieve(key, level);
            if (data?.level && typeof data.level === 'string') {
              const fromPayload = data.level as MemoryLevel;
              if (['L0', 'L1', 'L2', 'L3', 'L4'].includes(fromPayload)) {
                memLevel = fromPayload;
              }
            }
          } catch {
            /* use bucket default */
          }
          levelCounts[memLevel]++;
        }
      }
    } catch (err) {
      log.debug('MemorySystem list fallback:', err);
    }
    
    // 2. Add in-memory records NOT already counted from disk
    for (const record of recordStore.values()) {
      if (seenIds.has(record.id)) continue;
      if (record.id.startsWith('ref_')) continue;
      seenIds.add(record.id);
      levelCounts[record.level]++;
      levelConfidences[record.level].push(record.confidence);
      if (record.invalidatedAt) invalidatedCount++;
    }
    
    // Get fog of war stats
    let fogStats = { totalEntries: 0, activeEntries: 0 };
    try {
      const fogEntries = await this.memorySystem.getFogOfWar({});
      const activeFog = fogEntries.filter(e => !e.invalidated_at);
      fogStats = {
        totalEntries: fogEntries.length,
        activeEntries: activeFog.length
      };
    } catch (err) {
      log.debug('FogOfWar stats fallback:', err);
    }

    const totalRecords = Object.values(levelCounts).reduce((a, b) => a + b, 0);
    
    const levels: LevelStats[] = (['L0', 'L1', 'L2', 'L3', 'L4'] as MemoryLevel[]).map(level => {
      const confs = levelConfidences[level];
      const avgConf = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
      return {
        level,
        recordCount: levelCounts[level],
        avgConfidence: avgConf,
      };
    });

    return {
      projectId: this.projectPath,
      totalRecords,
      totalEntries: totalRecords,
      invalidatedCount,
      lastPromotionRun: undefined,
      levels,
      byLevel: levelCounts,
      fogOfWar: fogStats,
    };
  }

  /**
   * Run promotion cycle (auto-promote based on access patterns)
   * Sprint 6: L1→L2 creates split consolidated record; original stays at L1
   */
  async runPromotionCycle(): Promise<PromotionResult[]> {
    await this.initialize();
    
    const promotions: PromotionResult[] = [];
    
    for (const record of recordStore.values()) {
      if (record.accessCount >= 5 && record.level === 'L0') {
        const oldLevel = record.level;
        record.level = 'L1';
        record.promotedFrom = record.id;
        promotions.push({ record, fromLevel: oldLevel, toLevel: 'L1' });
      } else if (record.accessCount >= 10 && record.level === 'L1') {
        const consolidatedId = makeConsolidatedRecordId(record.id, 'L2');
        if (recordStore.has(consolidatedId)) {
          continue;
        }

        const l2Record: MemoryRecord = {
          id: consolidatedId,
          content: buildConsolidationPlaceholder(record.id, record.content),
          level: 'L2',
          source: record.source,
          contextKeys: [...record.contextKeys],
          confidence: record.confidence,
          accessCount: record.accessCount,
          createdAt: new Date(),
          lastAccessedAt: record.lastAccessedAt,
          promotedFrom: record.id,
          consolidatedFrom: record.id,
          needsConsolidation: true,
          dependencies: record.dependencies ? [...record.dependencies] : undefined,
          dependents: record.dependents ? [...record.dependents] : undefined,
          dependencyRelations: record.dependencyRelations
            ? { ...record.dependencyRelations }
            : undefined,
          contentHash: this.computeContentHash(
            buildConsolidationPlaceholder(record.id, record.content)
          ),
          lastValidated: Date.now(),
          metadata: {
            ...record.metadata,
            tags: [...(record.metadata.tags || [])],
          },
        };

        recordStore.set(consolidatedId, l2Record);
        promotions.push({
          record: l2Record,
          fromLevel: 'L1',
          toLevel: 'L2',
          originalId: record.id,
        });
      }
    }
    
    for (const promotion of promotions) {
      const { record } = promotion;
      if (promotion.toLevel === 'L1') {
        try {
          await this.persistRecord(record);
          log.info(`Promoted ${record.id}: L0 → L1`);
        } catch (err) {
          log.debug('Promotion persist error:', err);
        }
      } else if (promotion.toLevel === 'L2' && promotion.originalId) {
        try {
          await this.persistRecord(record);
          log.info(
            `Consolidation pending ${promotion.originalId} → ${record.id} (original at L1)`
          );
        } catch (err) {
          log.debug('Consolidation promotion persist error:', err);
        }
      }
    }
    
    return promotions;
  }

  /**
   * Sprint 6: Apply host-mediated consolidation to an L2+ pending record
   */
  async applyConsolidation(
    consolidatedId: string,
    content: string
  ): Promise<{ success: boolean; errors?: string[]; record?: MemoryRecord }> {
    await this.initialize();

    const record = recordStore.get(consolidatedId);
    if (!record) {
      return { success: false, errors: [`record not found: ${consolidatedId}`] };
    }

    let original: MemoryRecord | null = null;
    if (record.consolidatedFrom) {
      original = recordStore.get(record.consolidatedFrom) ?? null;
      if (!original) {
        original = await this.get(record.consolidatedFrom);
      }
    }

    const validation = validateConsolidation(
      original,
      record,
      content,
      (id) => recordStore.has(id) || id === record.consolidatedFrom
    );

    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    record.content = content;
    record.needsConsolidation = false;
    record.contentHash = this.computeContentHash(content);
    record.lastValidated = Date.now();

    await this.persistRecord(record);
    return { success: true, record };
  }

  /**
   * Sprint 6: Manual promotion with consolidation path for L2+
   */
  async promoteRecord(
    id: string,
    targetLevel: MemoryLevel
  ): Promise<{ success: boolean; error?: string; promotion?: PromotionResult }> {
    await this.initialize();

    const record = await this.get(id);
    if (!record) {
      return { success: false, error: `record not found: ${id}` };
    }

    const levelOrder: MemoryLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];
    if (levelOrder.indexOf(targetLevel) <= levelOrder.indexOf(record.level)) {
      return {
        success: false,
        error: `target ${targetLevel} must be above current ${record.level}`,
      };
    }

    if (!requiresConsolidation(targetLevel)) {
      const oldLevel = record.level;
      record.level = targetLevel;
      record.promotedFrom = record.promotedFrom ?? record.id;
      await this.persistRecord(record);
      const promotion: PromotionResult = { record, fromLevel: oldLevel, toLevel: targetLevel };
      return { success: true, promotion };
    }

    const consolidatedId = makeConsolidatedRecordId(record.id, targetLevel);
    if (recordStore.has(consolidatedId)) {
      return { success: false, error: `consolidated record already exists: ${consolidatedId}` };
    }

    const consolidated: MemoryRecord = {
      id: consolidatedId,
      content: buildConsolidationPlaceholder(record.id, record.content),
      level: targetLevel,
      source: record.source,
      contextKeys: [...record.contextKeys],
      confidence: record.confidence,
      accessCount: record.accessCount,
      createdAt: new Date(),
      promotedFrom: record.id,
      consolidatedFrom: record.id,
      needsConsolidation: true,
      dependencies: record.dependencies ? [...record.dependencies] : undefined,
      contentHash: this.computeContentHash(
        buildConsolidationPlaceholder(record.id, record.content)
      ),
      lastValidated: Date.now(),
      metadata: { ...record.metadata, tags: [...(record.metadata.tags || [])] },
    };

    recordStore.set(consolidatedId, consolidated);
    await this.persistRecord(consolidated);

    const promotion: PromotionResult = {
      record: consolidated,
      fromLevel: record.level,
      toLevel: targetLevel,
      originalId: record.id,
    };
    return { success: true, promotion };
  }

  /**
   * Handle code change - invalidate related records
   */
  async onCodeChange(filePath: string): Promise<MemoryRecord[]> {
    await this.initialize();
    
    const affected: MemoryRecord[] = [];
    
    for (const record of recordStore.values()) {
      // Check if record is related to the changed file
      if (record.contextKeys.includes(filePath) || record.content.includes(filePath)) {
        record.confidence *= 0.8; // Reduce confidence
        record.invalidatedAt = new Date();
        affected.push(record);
      }
    }
    
    // Note: FogOfWar invalidation is tracked in-memory
    // MemorySystem FogOfWar entries have invalidated_at field set manually
    
    return affected;
  }

  /**
   * Записать техническое открытие (Fog of War)
   */
  async discoverTechnical(
    path: string,
    discovery: string,
    details: any,
    source: SourceType,
    confidence: number,
    dependencies?: string[]
  ): Promise<void> {
    await this.initialize();
    
    const entry: FogOfWarEntry = {
      id: `fow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      path,
      discovery,
      technical_details: details,
      dependencies: dependencies || [],
      discovered_at: new Date(),
      confidence,
      source
    };

    await this.memorySystem.discoverTechnicalDetail(path, entry);
  }

  /**
   * Получить данные Fog of War
   */
  async getFogOfWar(filter?: {
    path?: string;
    source?: SourceType;
    minConfidence?: number;
    includeInvalidated?: boolean;
  }): Promise<FogOfWarEntry[]> {
    await this.initialize();
    return this.memorySystem.getFogOfWar(filter);
  }

  /**
   * Reload all memory from disk, clearing in-memory caches
   */
  async reload(): Promise<void> {
    recordStore.clear();
    deletedIds.clear();
    this.initialized = false;
    await this.memorySystem.reload();
    await this.initialize();
    log.info('UnifiedMemoryCore reloaded from disk');
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Apply time-based confidence decay. Records that haven't been
   * validated recently get lower effective confidence.
   */
  private applyConfidenceDecay(record: MemoryRecord): number {
    return getEffectiveConfidence(record);
  }

  /**
   * Auto-extract context keys from content when none are provided.
   */
  private extractContextKeys(content: string): string[] {
    const keys: string[] = [];
    const paths = content.match(/[\w\/\-\.]+\.(ts|js|md|json|py|rs|yaml|yml)/g);
    if (paths) keys.push(...paths.slice(0, 3));
    const camel = content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
    if (camel) keys.push(...[...new Set(camel)].slice(0, 3));
    const quoted = content.match(/"([^"]{3,30})"/g);
    if (quoted) keys.push(...quoted.map(q => q.replace(/"/g, '')).slice(0, 2));
    return [...new Set(keys)].slice(0, 5);
  }

  private mapLevelToStorage(level: MemoryLevel): string {
    const map: Record<MemoryLevel, string> = {
      L0: 'surface',
      L1: 'working',
      L2: 'longterm',
      L3: 'conceptual',
      L4: 'project'
    };
    return map[level];
  }

  private mapStorageToLevel(storage: string): MemoryLevel {
    const map: Record<string, MemoryLevel> = {
      surface: 'L0',
      working: 'L1',
      longterm: 'L2',
      conceptual: 'L3',
      project: 'L4'
    };
    return map[storage] || 'L0';
  }

  private calculateScore(query: string, record: MemoryRecord): number {
    if (!query) return 0.5;
    
    const queryLower = query.toLowerCase();
    const contentLower = record.content.toLowerCase();
    
    // Simple text matching score
    if (contentLower.includes(queryLower)) return 0.8;
    
    // Check context keys
    for (const key of record.contextKeys) {
      if (key.toLowerCase().includes(queryLower)) return 0.7;
    }
    
    // Word overlap
    const queryWords = queryLower.split(/\s+/);
    const contentWords = contentLower.split(/\s+/);
    const overlap = queryWords.filter(w => contentWords.includes(w)).length;
    
    return overlap > 0 ? 0.5 * (overlap / queryWords.length) : 0;
  }

  private convertToRecord(item: any): MemoryRecord {
    const data = item.data || item;
    let invalidatedAt: Date | undefined;
    if (data.invalidatedAt) {
      const d = new Date(data.invalidatedAt);
      invalidatedAt = Number.isNaN(d.getTime()) ? undefined : d;
    }
    const payloadLevel = data.level as string | undefined;
    const level: MemoryLevel =
      payloadLevel != null
      && (['L0', 'L1', 'L2', 'L3', 'L4'] as MemoryLevel[]).includes(payloadLevel as MemoryLevel)
        ? (payloadLevel as MemoryLevel)
        : this.mapStorageToLevel(item.level || item._level || 'surface');
    return {
      id: item._key || item.key || item.id || generateId(),
      content: data.content || JSON.stringify(data),
      level,
      source: (data.source || 'runtime') as SourceType,
      contextKeys: data.contextKeys || [],
      confidence: data.confidence ?? 0.5,
      accessCount: data.accessCount ?? 0,
      createdAt: data.timestamp ? new Date(data.timestamp) : new Date(),
      invalidatedAt,
      needsConsolidation: data.needsConsolidation === true,
      consolidatedFrom: data.consolidatedFrom,
      promotedFrom: data.promotedFrom,
      dependencies: data.dependencies,
      dependents: data.dependents,
      dependencyRelations: data.dependencyRelations,
      contentHash: data.contentHash,
      lastValidated: data.lastValidated,
      metadata: {
        type: data.source || 'runtime',
        source: data.contextKeys?.[0] || '',
        tags: data.contextKeys || [],
        importance: data.confidence ?? 0.5,
      },
    };
  }

  /** MEM-3: flush debounced memory writes on shutdown */
  async shutdown(): Promise<void> {
    await this.memorySystem.shutdown();
    await this.tombstoneWrites;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let memoryCore: UnifiedMemoryCore | null = null;
let memoryCoreProjectPath: string | null = null;
/** MEM-7: cores replaced by a project switch that are still writing their last changes */
const retiringCores = new Set<Promise<void>>();

function retireMemoryCore(): void {
  const previous = memoryCore;
  memoryCore = null;
  memoryCoreProjectPath = null;
  recordStore.clear();
  deletedIds.clear();
  if (!previous) return;
  const drain: Promise<void> = previous
    .shutdown()
    .catch(err => log.warn('Flush of the previous project memory failed:', err))
    .finally(() => retiringCores.delete(drain));
  retiringCores.add(drain);
}

// v3.19: Auto-reset singleton when workspace changes (MCP roots/list_changed)
onProjectPathChange((_oldPath, _newPath) => {
  log.info(`Workspace changed, resetting MemoryCore singleton`);
  retireMemoryCore();
});

/**
 * Получить singleton instance UnifiedMemoryCore.
 * v3.19: Always checks against current getProjectPath() to detect workspace switch.
 */
export async function getMemoryCore(projectPath?: string): Promise<UnifiedMemoryCore> {
  const resolvedPath = projectPath || getProjectPath();
  
  if (memoryCoreProjectPath && resolvedPath !== memoryCoreProjectPath) {
    log.info(`Project path changed (${memoryCoreProjectPath} → ${resolvedPath}), resetting MemoryCore`);
    retireMemoryCore();
  }
  
  if (!memoryCore) {
    memoryCore = new UnifiedMemoryCore(resolvedPath);
    memoryCoreProjectPath = resolvedPath;
    await memoryCore.initialize();
  }
  return memoryCore;
}

/**
 * MEM-3: Flush pending writes for the active memory core without creating a new instance.
 */
export async function shutdownMemoryCore(): Promise<void> {
  await Promise.all([memoryCore?.shutdown(), ...retiringCores]);
}

/**
 * Сбросить singleton (для тестов)
 */
export function resetMemoryCore(): void {
  memoryCore = null;
  memoryCoreProjectPath = null;
  recordStore.clear();
  deletedIds.clear();
}
