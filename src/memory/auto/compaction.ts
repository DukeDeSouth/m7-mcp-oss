/**
 * M7 Memory Auto-Compaction v1.0
 * 
 * Автоматическое сжатие старых записей памяти.
 * Объединяет похожие записи L0/L1, удаляет дубли, снижает объём.
 * 
 * Источник идеи: Pi (github.com/badlogic/pi-mono)
 * 
 * @version 1.0.0
 * @since M7 v3.10.4
 */

import { createLogger } from '../../core/utils/logger.js';
import { MemoryRecord, MemoryLevel } from './unified-memory-core.js';

const log = createLogger('[Compaction]');

// ============================================================================
// Types
// ============================================================================

export interface CompactionConfig {
  /** Максимум записей на уровне до принудительного сжатия */
  maxRecordsPerLevel: Record<MemoryLevel, number>;
  /** Минимальный возраст записи для сжатия (ms) */
  minAge: number;
  /** Порог схожести для объединения (0-1) */
  similarityThreshold: number;
  /** Минимальная confidence для сохранения */
  minConfidence: number;
}

export interface CompactionResult {
  /** Сколько записей было до */
  before: number;
  /** Сколько записей после */
  after: number;
  /** Сколько объединено */
  merged: number;
  /** Сколько удалено (low confidence / expired) */
  removed: number;
  /** Время выполнения (ms) */
  durationMs: number;
  /** Детали по уровням */
  byLevel: Record<string, { before: number; after: number }>;
}

export interface MergedRecord {
  /** ID нового объединённого рекорда */
  id: string;
  /** Объединённый контент */
  content: string;
  /** IDs исходных записей */
  sourceIds: string[];
  /** Средняя confidence */
  confidence: number;
}

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxRecordsPerLevel: {
    L0: 100,
    L1: 200,
    L2: 500,
    L3: 1000,
    L4: 2000
  },
  minAge: 1000 * 60 * 60, // 1 час
  similarityThreshold: 0.7,
  minConfidence: 0.1
};

// ============================================================================
// Compactor
// ============================================================================

export class MemoryCompactor {
  private config: CompactionConfig;
  
  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }
  
  /**
   * Выполнить compaction на наборе записей
   */
  compact(records: MemoryRecord[]): {
    kept: MemoryRecord[];
    merged: MergedRecord[];
    removed: string[];
    result: CompactionResult;
  } {
    const startTime = Date.now();
    const now = Date.now();
    
    const kept: MemoryRecord[] = [];
    const merged: MergedRecord[] = [];
    const removed: string[] = [];
    
    // Группируем по уровню
    const byLevel = new Map<MemoryLevel, MemoryRecord[]>();
    for (const record of records) {
      const level = record.level;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)!.push(record);
    }
    
    const levelStats: Record<string, { before: number; after: number }> = {};
    
    for (const [level, levelRecords] of byLevel) {
      const beforeCount = levelRecords.length;
      const maxRecords = this.config.maxRecordsPerLevel[level];
      
      // Шаг 1: Удаляем записи с низкой confidence
      const viable = levelRecords.filter(r => {
        if (r.confidence < this.config.minConfidence) {
          removed.push(r.id);
          return false;
        }
        return true;
      });
      
      // Шаг 2: Если записей больше лимита — сжимаем
      if (viable.length > maxRecords) {
        const { keepRecords, mergeGroups, removeIds } = this.compactLevel(
          viable, 
          maxRecords, 
          now
        );
        
        kept.push(...keepRecords);
        merged.push(...mergeGroups);
        removed.push(...removeIds);
        
        levelStats[level] = { 
          before: beforeCount, 
          after: keepRecords.length + mergeGroups.length 
        };
      } else {
        kept.push(...viable);
        levelStats[level] = { before: beforeCount, after: viable.length };
      }
    }
    
    const result: CompactionResult = {
      before: records.length,
      after: kept.length + merged.length,
      merged: merged.length,
      removed: removed.length,
      durationMs: Date.now() - startTime,
      byLevel: levelStats
    };
    
    log.info(
      `Compaction: ${result.before} → ${result.after} records ` +
      `(merged: ${result.merged}, removed: ${result.removed}, ${result.durationMs}ms)`
    );
    
    return { kept, merged, removed, result };
  }
  
  /**
   * Сжать записи одного уровня
   */
  private compactLevel(
    records: MemoryRecord[],
    maxRecords: number,
    now: number
  ): {
    keepRecords: MemoryRecord[];
    mergeGroups: MergedRecord[];
    removeIds: string[];
  } {
    const keepRecords: MemoryRecord[] = [];
    const mergeGroups: MergedRecord[] = [];
    const removeIds: string[] = [];
    
    // Сортируем: свежие и высоко-confidence — первые
    const sorted = [...records].sort((a, b) => {
      const scoreA = a.confidence * 0.6 + (1 - (now - a.createdAt.getTime()) / (now || 1)) * 0.4;
      const scoreB = b.confidence * 0.6 + (1 - (now - b.createdAt.getTime()) / (now || 1)) * 0.4;
      return scoreB - scoreA;
    });
    
    // Первые maxRecords * 0.7 — сохраняем как есть (top records)
    const keepCount = Math.floor(maxRecords * 0.7);
    const toKeep = sorted.slice(0, keepCount);
    const toCompact = sorted.slice(keepCount);
    
    keepRecords.push(...toKeep);
    
    // Остальные — группируем по схожести и объединяем
    const processed = new Set<string>();
    
    for (let i = 0; i < toCompact.length; i++) {
      const record = toCompact[i];
      if (processed.has(record.id)) continue;
      
      // Находим похожие
      const similar: MemoryRecord[] = [record];
      processed.add(record.id);
      
      for (let j = i + 1; j < toCompact.length; j++) {
        const other = toCompact[j];
        if (processed.has(other.id)) continue;
        
        const sim = this.computeSimilarity(record.content, other.content);
        if (sim >= this.config.similarityThreshold) {
          similar.push(other);
          processed.add(other.id);
        }
      }
      
      if (similar.length > 1) {
        // Объединяем
        const mergedContent = this.mergeContents(similar);
        const avgConfidence = similar.reduce((s, r) => s + r.confidence, 0) / similar.length;
        
        mergeGroups.push({
          id: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          content: mergedContent,
          sourceIds: similar.map(r => r.id),
          confidence: avgConfidence
        });
      } else if (now - record.createdAt.getTime() > this.config.minAge) {
        // Старая одиночная запись — удаляем если превышен лимит
        if (keepRecords.length + mergeGroups.length >= maxRecords) {
          removeIds.push(record.id);
        } else {
          keepRecords.push(record);
        }
      } else {
        keepRecords.push(record);
      }
    }
    
    return { keepRecords, mergeGroups, removeIds };
  }
  
  /**
   * Вычислить схожесть двух текстов (Jaccard по словам)
   */
  computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    
    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }
    
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
  
  /**
   * Объединить содержимое похожих записей
   */
  mergeContents(records: MemoryRecord[]): string {
    // Берём самую длинную запись как основу
    const sorted = [...records].sort((a, b) => b.content.length - a.content.length);
    const base = sorted[0];
    
    // Добавляем уникальные фрагменты из остальных
    const baseWords = new Set(base.content.toLowerCase().split(/\s+/));
    const additions: string[] = [];
    
    for (let i = 1; i < sorted.length; i++) {
      const other = sorted[i];
      const sentences = other.content.split(/[.!?]+/).filter(s => s.trim());
      
      for (const sentence of sentences) {
        const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const newWords = words.filter(w => !baseWords.has(w));
        
        // Если > 30% новых слов — добавляем
        if (words.length > 0 && newWords.length / words.length > 0.3) {
          additions.push(sentence.trim());
          newWords.forEach(w => baseWords.add(w));
        }
      }
    }
    
    if (additions.length > 0) {
      return `${base.content}\n[Merged from ${records.length} records]: ${additions.join('. ')}`;
    }
    
    return base.content;
  }
  
  /**
   * Проверить нужен ли compaction
   */
  needsCompaction(records: MemoryRecord[]): boolean {
    const byLevel = new Map<MemoryLevel, number>();
    
    for (const record of records) {
      const count = (byLevel.get(record.level) || 0) + 1;
      byLevel.set(record.level, count);
      
      if (count > this.config.maxRecordsPerLevel[record.level]) {
        return true;
      }
    }
    
    return false;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let compactor: MemoryCompactor | null = null;

export function getCompactor(config?: Partial<CompactionConfig>): MemoryCompactor {
  if (!compactor) {
    compactor = new MemoryCompactor(config);
  }
  return compactor;
}
