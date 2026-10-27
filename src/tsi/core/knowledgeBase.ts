import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
import { 
  IKnowledgeBase, 
  TechPattern, 
  PatternSearchCriteria, 
  PatternUsageStats, 
  PatternFeedback,
  KnowledgeBaseConfig,
  TSIEvent
} from './types.js';

/**
 * M7 Tech Safety Intelligence - Knowledge Base
 * Централизованная база знаний паттернов и антипаттернов
 */
export class KnowledgeBase implements IKnowledgeBase {
  private patterns: Map<string, TechPattern> = new Map();
  private usageStats: Map<string, PatternUsageStats> = new Map();
  private feedback: Map<string, PatternFeedback[]> = new Map();
  private config: KnowledgeBaseConfig;
  private dataPath: string;
  private cacheSize: number;
  private lastUpdate: Date = new Date();

  constructor(config: KnowledgeBaseConfig) {
    this.config = config;
    this.dataPath = config.dataPath || path.join(getProjectPath(), '.m7', 'tsi');
    this.cacheSize = config.cacheSize || 1000;
  }

  /**
   * Инициализация базы знаний
   */
  async initialize(): Promise<void> {
    try {
      // Создаем директории если не существуют
      await this.ensureDirectories();
      
      // Загружаем существующие паттерны
      await this.loadPatterns();
      
      // Загружаем статистику
      await this.loadUsageStats();
      
      // Загружаем обратную связь
      await this.loadFeedback();
      
      logger.info(`[TSI KB] Initialized with ${this.patterns.size} patterns`);
    } catch (error) {
      log.debug('TSI KB] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Поиск паттернов по критериям
   */
  async findPatterns(criteria: PatternSearchCriteria): Promise<TechPattern[]> {
    const patterns = Array.from(this.patterns.values());
    
    let filtered = patterns.filter(pattern => {
      // Фильтр по технологии
      if (criteria.technology && pattern.technology !== criteria.technology) {
        return false;
      }
      
      // Фильтр по категории
      if (criteria.category && pattern.category !== criteria.category) {
        return false;
      }
      
      // Фильтр по типу
      if (criteria.type && pattern.type !== criteria.type) {
        return false;
      }
      
      // Фильтр по уровню риска
      if (criteria.riskLevel) {
        const hasRiskLevel = pattern.risks.some(risk => risk.level === criteria.riskLevel);
        if (!hasRiskLevel) return false;
      }
      
      // Фильтр по тегам
      if (criteria.tags && criteria.tags.length > 0) {
        const hasAllTags = criteria.tags.every(tag => pattern.tags.includes(tag));
        if (!hasAllTags) return false;
      }
      
      // Фильтр по минимальному доверию
      if (criteria.minConfidence && pattern.confidence < criteria.minConfidence) {
        return false;
      }
      
      // Фильтр по максимальному риску
      if (criteria.maxRiskScore && pattern.riskScore > criteria.maxRiskScore) {
        return false;
      }
      
      return true;
    });
    
    // Сортировка по релевантности (confidence * successRate)
    filtered.sort((a, b) => {
      const scoreA = a.confidence * a.successRate;
      const scoreB = b.confidence * b.successRate;
      return scoreB - scoreA;
    });
    
    // Пагинация
    const offset = criteria.offset || 0;
    const limit = criteria.limit || 50;
    
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Получение паттерна по ID
   */
  async getPattern(id: string): Promise<TechPattern | null> {
    return this.patterns.get(id) || null;
  }

  /**
   * Добавление нового паттерна
   */
  async addPattern(pattern: TechPattern): Promise<void> {
    // Валидация паттерна
    this.validatePattern(pattern);
    
    // Добавляем в память
    this.patterns.set(pattern.id, pattern);
    
    // Инициализируем статистику
    this.usageStats.set(pattern.id, {
      patternId: pattern.id,
      technology: pattern.technology,
      totalUsage: 0,
      successfulUsage: 0,
      failedUsage: 0,
      averageRating: 0,
      lastUsed: new Date(),
      trendingScore: 0
    });
    
    // Сохраняем на диск
    await this.savePattern(pattern);
    
    logger.info(`[TSI KB] Added pattern: ${pattern.id} (${pattern.technology})`);
  }

  /**
   * Обновление паттерна
   */
  async updatePattern(id: string, updates: Partial<TechPattern>): Promise<void> {
    const existing = this.patterns.get(id);
    if (!existing) {
      throw new Error(`Pattern not found: ${id}`);
    }
    
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.validatePattern(updated);
    
    this.patterns.set(id, updated);
    await this.savePattern(updated);
    
    logger.info(`[TSI KB] Updated pattern: ${id}`);
  }

  /**
   * Удаление паттерна
   */
  async deletePattern(id: string): Promise<void> {
    if (!this.patterns.has(id)) {
      throw new Error(`Pattern not found: ${id}`);
    }
    
    this.patterns.delete(id);
    this.usageStats.delete(id);
    this.feedback.delete(id);
    
    // Удаляем файл
    const filePath = path.join(this.dataPath, 'patterns', `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      log.warn(`TSI KB] Could not delete pattern file: ${filePath}`);
    }
    
    logger.info(`[TSI KB] Deleted pattern: ${id}`);
  }

  /**
   * Получение статистики использования
   */
  async getUsageStats(patternId: string): Promise<PatternUsageStats> {
    const stats = this.usageStats.get(patternId);
    if (!stats) {
      throw new Error(`Usage stats not found for pattern: ${patternId}`);
    }
    return stats;
  }

  /**
   * Запись использования паттерна
   */
  async recordUsage(patternId: string, success: boolean): Promise<void> {
    const stats = this.usageStats.get(patternId);
    if (!stats) {
      log.warn(`TSI KB] No stats found for pattern: ${patternId}`);
      return;
    }
    
    stats.totalUsage++;
    if (success) {
      stats.successfulUsage++;
    } else {
      stats.failedUsage++;
    }
    stats.lastUsed = new Date();
    
    // Обновляем trending score (простая формула)
    const successRate = stats.successfulUsage / stats.totalUsage;
    const recency = Math.max(0, 1 - (Date.now() - stats.lastUsed.getTime()) / (7 * 24 * 60 * 60 * 1000)); // 7 дней
    stats.trendingScore = successRate * 0.7 + recency * 0.3;
    
    // Обновляем success rate в паттерне
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.successRate = successRate;
      pattern.usageCount = stats.totalUsage;
    }
    
    await this.saveUsageStats();
  }

  /**
   * Добавление обратной связи
   */
  async addFeedback(feedback: PatternFeedback): Promise<void> {
    if (!this.feedback.has(feedback.patternId)) {
      this.feedback.set(feedback.patternId, []);
    }
    
    this.feedback.get(feedback.patternId)!.push(feedback);
    
    // Обновляем средний рейтинг в статистике
    await this.updateAverageRating(feedback.patternId);
    
    await this.saveFeedback();
    
    logger.info(`[TSI KB] Added feedback for pattern: ${feedback.patternId}`);
  }

  /**
   * Получение обратной связи
   */
  async getFeedback(patternId: string): Promise<PatternFeedback[]> {
    return this.feedback.get(patternId) || [];
  }

  /**
   * Получение топ паттернов по технологии
   */
  async getTopPatterns(technology: string, limit: number = 10): Promise<TechPattern[]> {
    const patterns = await this.findPatterns({ technology });
    
    return patterns
      .sort((a, b) => {
        const statsA = this.usageStats.get(a.id);
        const statsB = this.usageStats.get(b.id);
        
        const scoreA = (statsA?.trendingScore || 0) * a.confidence;
        const scoreB = (statsB?.trendingScore || 0) * b.confidence;
        
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Поиск похожих паттернов
   */
  async findSimilarPatterns(pattern: TechPattern, limit: number = 5): Promise<TechPattern[]> {
    const allPatterns = Array.from(this.patterns.values());
    
    const similarities = allPatterns
      .filter(p => p.id !== pattern.id)
      .map(p => ({
        pattern: p,
        similarity: this.calculateSimilarity(pattern, p)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    return similarities.map(s => s.pattern);
  }

  /**
   * Экспорт паттернов в JSON
   */
  async exportPatterns(technology?: string): Promise<string> {
    let patterns: TechPattern[];
    
    if (technology) {
      patterns = await this.findPatterns({ technology });
    } else {
      patterns = Array.from(this.patterns.values());
    }
    
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      technology,
      count: patterns.length,
      patterns
    }, null, 2);
  }

  /**
   * Импорт паттернов из JSON
   */
  async importPatterns(jsonData: string): Promise<number> {
    try {
      const data = JSON.parse(jsonData);
      let imported = 0;
      
      for (const pattern of data.patterns) {
        try {
          await this.addPattern(pattern);
          imported++;
        } catch (error) {
          log.warn(`TSI KB] Failed to import pattern ${pattern.id}:`, error);
        }
      }
      
      logger.info(`[TSI KB] Imported ${imported} patterns`);
      return imported;
    } catch (error) {
      log.debug('TSI KB] Import failed:', error);
      throw error;
    }
  }

  // Приватные методы

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.dataPath,
      path.join(this.dataPath, 'patterns'),
      path.join(this.dataPath, 'stats'),
      path.join(this.dataPath, 'feedback')
    ];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // Игнорируем если директория уже существует
      }
    }
  }

  private async loadPatterns(): Promise<void> {
    const patternsDir = path.join(this.dataPath, 'patterns');
    
    try {
      const files = await fs.readdir(patternsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(patternsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const pattern: TechPattern = JSON.parse(content);
          
          // Восстанавливаем даты
          pattern.createdAt = new Date(pattern.createdAt);
          pattern.updatedAt = new Date(pattern.updatedAt);
          
          this.patterns.set(pattern.id, pattern);
        } catch (error) {
          log.warn(`TSI KB] Failed to load pattern from ${file}:`, error);
        }
      }
    } catch (error) {
      logger.info('[TSI KB] No existing patterns found, starting fresh');
    }
  }

  private async savePattern(pattern: TechPattern): Promise<void> {
    const filePath = path.join(this.dataPath, 'patterns', `${pattern.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(pattern, null, 2));
  }

  private async loadUsageStats(): Promise<void> {
    const statsPath = path.join(this.dataPath, 'stats', 'usage.json');
    
    try {
      const content = await fs.readFile(statsPath, 'utf-8');
      const statsArray: PatternUsageStats[] = JSON.parse(content);
      
      for (const stats of statsArray) {
        stats.lastUsed = new Date(stats.lastUsed);
        this.usageStats.set(stats.patternId, stats);
      }
    } catch (error) {
      logger.info('[TSI KB] No existing usage stats found');
    }
  }

  private async saveUsageStats(): Promise<void> {
    const statsPath = path.join(this.dataPath, 'stats', 'usage.json');
    const statsArray = Array.from(this.usageStats.values());
    await fs.writeFile(statsPath, JSON.stringify(statsArray, null, 2));
  }

  private async loadFeedback(): Promise<void> {
    const feedbackPath = path.join(this.dataPath, 'feedback', 'feedback.json');
    
    try {
      const content = await fs.readFile(feedbackPath, 'utf-8');
      const feedbackData: { [patternId: string]: PatternFeedback[] } = JSON.parse(content);
      
      for (const [patternId, feedbacks] of Object.entries(feedbackData)) {
        for (const feedback of feedbacks) {
          feedback.timestamp = new Date(feedback.timestamp);
        }
        this.feedback.set(patternId, feedbacks);
      }
    } catch (error) {
      logger.info('[TSI KB] No existing feedback found');
    }
  }

  private async saveFeedback(): Promise<void> {
    const feedbackPath = path.join(this.dataPath, 'feedback', 'feedback.json');
    const feedbackData: { [patternId: string]: PatternFeedback[] } = {};
    
    for (const [patternId, feedbacks] of this.feedback.entries()) {
      feedbackData[patternId] = feedbacks;
    }
    
    await fs.writeFile(feedbackPath, JSON.stringify(feedbackData, null, 2));
  }

  private validatePattern(pattern: TechPattern): void {
    if (!pattern.id || !pattern.name || !pattern.technology) {
      throw new Error('Pattern must have id, name, and technology');
    }
    
    if (pattern.confidence < 0 || pattern.confidence > 1) {
      throw new Error('Pattern confidence must be between 0 and 1');
    }
    
    if (pattern.riskScore < 0 || pattern.riskScore > 100) {
      throw new Error('Pattern risk score must be between 0 and 100');
    }
  }

  private async updateAverageRating(patternId: string): Promise<void> {
    const feedbacks = this.feedback.get(patternId) || [];
    const stats = this.usageStats.get(patternId);
    
    if (stats && feedbacks.length > 0) {
      const totalRating = feedbacks.reduce((sum, f) => sum + f.rating, 0);
      stats.averageRating = totalRating / feedbacks.length;
    }
  }

  private calculateSimilarity(pattern1: TechPattern, pattern2: TechPattern): number {
    let similarity = 0;
    
    // Технология (40%)
    if (pattern1.technology === pattern2.technology) {
      similarity += 0.4;
    }
    
    // Категория (20%)
    if (pattern1.category === pattern2.category) {
      similarity += 0.2;
    }
    
    // Теги (30%)
    const commonTags = pattern1.tags.filter(tag => pattern2.tags.includes(tag));
    const tagSimilarity = commonTags.length / Math.max(pattern1.tags.length, pattern2.tags.length);
    similarity += tagSimilarity * 0.3;
    
    // Уровень риска (10%)
    const riskDiff = Math.abs(pattern1.riskScore - pattern2.riskScore);
    const riskSimilarity = 1 - (riskDiff / 100);
    similarity += riskSimilarity * 0.1;
    
    return similarity;
  }
}
