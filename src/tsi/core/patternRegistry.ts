import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
import { 
  IPatternRegistry, 
  TechPattern, 
  PatternSearchCriteria 
} from './types.js';
import { YamlPatternLoader } from './yamlLoader.js';

/**
 * M7 Tech Safety Intelligence - Pattern Registry
 * Реестр паттернов с версионированием и управлением жизненным циклом
 */
export class PatternRegistry implements IPatternRegistry {
  private patterns: Map<string, TechPattern> = new Map();
  private versions: Map<string, Map<string, TechPattern>> = new Map();
  private dataPath: string;
  private yamlLoader: YamlPatternLoader;
  private bundledPatternsLoaded = false;

  constructor(dataPath?: string) {
    this.dataPath = dataPath || path.join(getProjectPath(), '.m7', 'tsi', 'registry');
    this.yamlLoader = new YamlPatternLoader();
  }

  /**
   * Инициализация реестра
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureDirectories();
      
      // 1. Load bundled YAML patterns first (from package)
      await this.loadBundledPatterns();
      
      // 2. Load user patterns from disk (can override bundled)
      await this.loadRegistry();
      
      logger.info(`[TSI Registry] Initialized with ${this.patterns.size} patterns`);
    } catch (error) {
      log.debug('TSI Registry] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Load bundled patterns from YAML files in the package
   */
  private async loadBundledPatterns(): Promise<void> {
    if (this.bundledPatternsLoaded) return;
    
    try {
      const result = await this.yamlLoader.loadBundled();
      
      for (const pattern of result.patterns) {
        // Only add if not already present (user patterns take precedence)
        if (!this.patterns.has(pattern.id)) {
          this.patterns.set(pattern.id, pattern);
        }
      }
      
      this.bundledPatternsLoaded = true;
      
      if (result.errors.length > 0) {
        log.debug(`[TSI Registry] Some bundled patterns failed to load: ${result.errors.length} errors`);
      }
      
      log.debug(`[TSI Registry] Loaded ${result.stats.patternsLoaded} bundled patterns`);
      log.debug(`[TSI Registry] By category: ${JSON.stringify(result.stats.byCategory)}`);
    } catch (error) {
      log.debug('[TSI Registry] Failed to load bundled patterns:', error);
      // Don't throw - bundled patterns are optional
    }
  }

  /**
   * Регистрация нового паттерна
   */
  async register(pattern: TechPattern): Promise<void> {
    // Валидация
    this.validatePattern(pattern);
    
    // Проверяем на дубликаты
    if (this.patterns.has(pattern.id)) {
      throw new Error(`Pattern already registered: ${pattern.id}`);
    }
    
    // Устанавливаем метаданные
    pattern.createdAt = new Date();
    pattern.updatedAt = new Date();
    pattern.usageCount = 0;
    pattern.successRate = 0;
    
    // Регистрируем паттерн
    this.patterns.set(pattern.id, pattern);
    
    // Создаем первую версию
    await this.createVersion(pattern.id, '1.0.0');
    
    // Сохраняем на диск
    await this.savePattern(pattern);
    
    logger.info(`[TSI Registry] Registered pattern: ${pattern.id} v1.0.0`);
  }

  /**
   * Отмена регистрации паттерна
   */
  async unregister(id: string): Promise<void> {
    if (!this.patterns.has(id)) {
      throw new Error(`Pattern not found: ${id}`);
    }
    
    // Удаляем из памяти
    this.patterns.delete(id);
    this.versions.delete(id);
    
    // Удаляем файлы
    await this.deletePatternFiles(id);
    
    logger.info(`[TSI Registry] Unregistered pattern: ${id}`);
  }

  /**
   * Список паттернов по критериям
   */
  async list(criteria?: PatternSearchCriteria): Promise<TechPattern[]> {
    let patterns = Array.from(this.patterns.values());
    
    if (!criteria) {
      return patterns;
    }
    
    // Применяем фильтры
    patterns = patterns.filter(pattern => {
      if (criteria.technology && pattern.technology !== criteria.technology) {
        return false;
      }
      
      if (criteria.category && pattern.category !== criteria.category) {
        return false;
      }
      
      if (criteria.type && pattern.type !== criteria.type) {
        return false;
      }
      
      if (criteria.tags && criteria.tags.length > 0) {
        const hasAllTags = criteria.tags.every(tag => pattern.tags.includes(tag));
        if (!hasAllTags) return false;
      }
      
      if (criteria.minConfidence && pattern.confidence < criteria.minConfidence) {
        return false;
      }
      
      if (criteria.maxRiskScore && pattern.riskScore > criteria.maxRiskScore) {
        return false;
      }
      
      return true;
    });
    
    // Сортировка по релевантности
    patterns.sort((a, b) => {
      // Сначала по confidence, потом по success rate
      const scoreA = a.confidence * 0.6 + a.successRate * 0.4;
      const scoreB = b.confidence * 0.6 + b.successRate * 0.4;
      return scoreB - scoreA;
    });
    
    // Пагинация
    const offset = criteria.offset || 0;
    const limit = criteria.limit || 100;
    
    return patterns.slice(offset, offset + limit);
  }

  /**
   * Получение паттерна по ID
   */
  async get(id: string): Promise<TechPattern | null> {
    return this.patterns.get(id) || null;
  }

  /**
   * Обновление паттерна
   */
  async update(id: string, updates: Partial<TechPattern>): Promise<void> {
    const existing = this.patterns.get(id);
    if (!existing) {
      throw new Error(`Pattern not found: ${id}`);
    }
    
    // Создаем обновленную версию
    const updated = { 
      ...existing, 
      ...updates, 
      id: existing.id, // ID нельзя изменить
      updatedAt: new Date() 
    };
    
    this.validatePattern(updated);
    
    // Обновляем в памяти
    this.patterns.set(id, updated);
    
    // Сохраняем на диск
    await this.savePattern(updated);
    
    logger.info(`[TSI Registry] Updated pattern: ${id}`);
  }

  /**
   * Создание новой версии паттерна
   */
  async createVersion(id: string, version: string): Promise<void> {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new Error(`Pattern not found: ${id}`);
    }
    
    // Инициализируем версии для паттерна если нужно
    if (!this.versions.has(id)) {
      this.versions.set(id, new Map());
    }
    
    const patternVersions = this.versions.get(id)!;
    
    // Проверяем что версия не существует
    if (patternVersions.has(version)) {
      throw new Error(`Version ${version} already exists for pattern ${id}`);
    }
    
    // Создаем копию паттерна для версии
    const versionedPattern = { 
      ...pattern, 
      version,
      createdAt: new Date(pattern.createdAt),
      updatedAt: new Date()
    };
    
    // Сохраняем версию
    patternVersions.set(version, versionedPattern);
    
    // Сохраняем на диск
    await this.savePatternVersion(id, version, versionedPattern);
    
    logger.info(`[TSI Registry] Created version ${version} for pattern: ${id}`);
  }

  /**
   * Получение списка версий паттерна
   */
  async getVersions(id: string): Promise<string[]> {
    const patternVersions = this.versions.get(id);
    if (!patternVersions) {
      return [];
    }
    
    return Array.from(patternVersions.keys()).sort((a, b) => {
      // Простая сортировка версий
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }

  /**
   * Получение конкретной версии паттерна
   */
  async getVersion(id: string, version: string): Promise<TechPattern | null> {
    const patternVersions = this.versions.get(id);
    if (!patternVersions) {
      return null;
    }
    
    return patternVersions.get(version) || null;
  }

  /**
   * Поиск паттернов по тексту
   */
  async search(query: string, limit: number = 20): Promise<TechPattern[]> {
    const patterns = Array.from(this.patterns.values());
    const lowerQuery = query.toLowerCase();
    
    // Простой поиск по названию, описанию и тегам
    const matches = patterns.filter(pattern => {
      const searchText = [
        pattern.name,
        pattern.description,
        pattern.technology,
        ...pattern.tags
      ].join(' ').toLowerCase();
      
      return searchText.includes(lowerQuery);
    });
    
    // Сортируем по релевантности (простая формула)
    matches.sort((a, b) => {
      const scoreA = this.calculateRelevanceScore(a, lowerQuery);
      const scoreB = this.calculateRelevanceScore(b, lowerQuery);
      return scoreB - scoreA;
    });
    
    return matches.slice(0, limit);
  }

  /**
   * Получение статистики реестра
   */
  async getStats(): Promise<{
    totalPatterns: number;
    patternsByTechnology: { [tech: string]: number };
    patternsByCategory: { [category: string]: number };
    patternsByType: { [type: string]: number };
    averageConfidence: number;
    averageRiskScore: number;
  }> {
    const patterns = Array.from(this.patterns.values());
    
    const stats = {
      totalPatterns: patterns.length,
      patternsByTechnology: {} as { [tech: string]: number },
      patternsByCategory: {} as { [category: string]: number },
      patternsByType: {} as { [type: string]: number },
      averageConfidence: 0,
      averageRiskScore: 0
    };
    
    if (patterns.length === 0) {
      return stats;
    }
    
    // Подсчитываем статистику
    let totalConfidence = 0;
    let totalRiskScore = 0;
    
    for (const pattern of patterns) {
      // По технологиям
      stats.patternsByTechnology[pattern.technology] = 
        (stats.patternsByTechnology[pattern.technology] || 0) + 1;
      
      // По категориям
      stats.patternsByCategory[pattern.category] = 
        (stats.patternsByCategory[pattern.category] || 0) + 1;
      
      // По типам
      stats.patternsByType[pattern.type] = 
        (stats.patternsByType[pattern.type] || 0) + 1;
      
      totalConfidence += pattern.confidence;
      totalRiskScore += pattern.riskScore;
    }
    
    stats.averageConfidence = totalConfidence / patterns.length;
    stats.averageRiskScore = totalRiskScore / patterns.length;
    
    return stats;
  }

  /**
   * Экспорт реестра
   */
  async export(): Promise<string> {
    const patterns = Array.from(this.patterns.values());
    const versions = {} as { [id: string]: { [version: string]: TechPattern } };
    
    // Экспортируем версии
    for (const [id, patternVersions] of this.versions.entries()) {
      versions[id] = {};
      for (const [version, pattern] of patternVersions.entries()) {
        versions[id][version] = pattern;
      }
    }
    
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      registry_version: '1.0.0',
      patterns,
      versions
    }, null, 2);
  }

  /**
   * Импорт реестра
   */
  async import(data: string): Promise<{ imported: number; errors: string[] }> {
    const result = { imported: 0, errors: [] as string[] };
    
    try {
      const registryData = JSON.parse(data);
      
      // Импортируем паттерны
      for (const pattern of registryData.patterns || []) {
        try {
          // Восстанавливаем даты
          pattern.createdAt = new Date(pattern.createdAt);
          pattern.updatedAt = new Date(pattern.updatedAt);
          
          // Регистрируем если не существует
          if (!this.patterns.has(pattern.id)) {
            this.patterns.set(pattern.id, pattern);
            await this.savePattern(pattern);
            result.imported++;
          }
        } catch (error) {
          result.errors.push(`Failed to import pattern ${pattern.id}: ${error}`);
        }
      }
      
      // Импортируем версии
      for (const [id, patternVersions] of Object.entries(registryData.versions || {})) {
        if (!this.versions.has(id)) {
          this.versions.set(id, new Map());
        }
        
        const versionMap = this.versions.get(id)!;
        
        for (const [version, pattern] of Object.entries(patternVersions as any)) {
          try {
            const versionedPattern = pattern as TechPattern;
            versionedPattern.createdAt = new Date(versionedPattern.createdAt);
            versionedPattern.updatedAt = new Date(versionedPattern.updatedAt);
            
            versionMap.set(version, versionedPattern);
            await this.savePatternVersion(id, version, versionedPattern);
          } catch (error) {
            result.errors.push(`Failed to import version ${version} for pattern ${id}: ${error}`);
          }
        }
      }
      
    } catch (error) {
      result.errors.push(`Failed to parse registry data: ${error}`);
    }
    
    return result;
  }

  // Приватные методы

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.dataPath,
      path.join(this.dataPath, 'patterns'),
      path.join(this.dataPath, 'versions')
    ];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // Игнорируем если директория уже существует
      }
    }
  }

  private async loadRegistry(): Promise<void> {
    // Загружаем основные паттерны
    await this.loadPatterns();
    
    // Загружаем версии
    await this.loadVersions();
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
          log.warn(`TSI Registry] Failed to load pattern from ${file}:`, error);
        }
      }
    } catch (error) {
      logger.info('[TSI Registry] No existing patterns found');
    }
  }

  private async loadVersions(): Promise<void> {
    const versionsDir = path.join(this.dataPath, 'versions');
    
    try {
      const patternDirs = await fs.readdir(versionsDir);
      
      for (const patternDir of patternDirs) {
        const patternVersionsPath = path.join(versionsDir, patternDir);
        const stat = await fs.stat(patternVersionsPath);
        
        if (stat.isDirectory()) {
          const versionFiles = await fs.readdir(patternVersionsPath);
          const jsonFiles = versionFiles.filter(f => f.endsWith('.json'));
          
          if (jsonFiles.length > 0) {
            this.versions.set(patternDir, new Map());
            const versionMap = this.versions.get(patternDir)!;
            
            for (const versionFile of jsonFiles) {
              try {
                const version = path.basename(versionFile, '.json');
                const filePath = path.join(patternVersionsPath, versionFile);
                const content = await fs.readFile(filePath, 'utf-8');
                const pattern: TechPattern = JSON.parse(content);
                
                pattern.createdAt = new Date(pattern.createdAt);
                pattern.updatedAt = new Date(pattern.updatedAt);
                
                versionMap.set(version, pattern);
              } catch (error) {
                log.warn(`TSI Registry] Failed to load version from ${versionFile}:`, error);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.info('[TSI Registry] No existing versions found');
    }
  }

  private async savePattern(pattern: TechPattern): Promise<void> {
    const filePath = path.join(this.dataPath, 'patterns', `${pattern.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(pattern, null, 2));
  }

  private async savePatternVersion(id: string, version: string, pattern: TechPattern): Promise<void> {
    const versionDir = path.join(this.dataPath, 'versions', id);
    await fs.mkdir(versionDir, { recursive: true });
    
    const filePath = path.join(versionDir, `${version}.json`);
    await fs.writeFile(filePath, JSON.stringify(pattern, null, 2));
  }

  private async deletePatternFiles(id: string): Promise<void> {
    // Удаляем основной файл паттерна
    try {
      const patternPath = path.join(this.dataPath, 'patterns', `${id}.json`);
      await fs.unlink(patternPath);
    } catch (error) {
      log.warn(`TSI Registry] Could not delete pattern file for ${id}`);
    }
    
    // Удаляем директорию с версиями
    try {
      const versionsPath = path.join(this.dataPath, 'versions', id);
      await fs.rm(versionsPath, { recursive: true, force: true });
    } catch (error) {
      log.warn(`TSI Registry] Could not delete versions directory for ${id}`);
    }
  }

  private validatePattern(pattern: TechPattern): void {
    if (!pattern.id) {
      throw new Error('Pattern must have an ID');
    }
    
    if (!pattern.name) {
      throw new Error('Pattern must have a name');
    }
    
    if (!pattern.technology) {
      throw new Error('Pattern must specify a technology');
    }
    
    if (!pattern.description) {
      throw new Error('Pattern must have a description');
    }
    
    if (pattern.confidence < 0 || pattern.confidence > 1) {
      throw new Error('Pattern confidence must be between 0 and 1');
    }
    
    if (pattern.riskScore < 0 || pattern.riskScore > 100) {
      throw new Error('Pattern risk score must be between 0 and 100');
    }
    
    if (!Array.isArray(pattern.implementation)) {
      throw new Error('Pattern must have implementation examples');
    }
    
    if (!Array.isArray(pattern.risks)) {
      throw new Error('Pattern must have risk information');
    }
  }

  private calculateRelevanceScore(pattern: TechPattern, query: string): number {
    let score = 0;
    
    // Название (высокий приоритет)
    if (pattern.name.toLowerCase().includes(query)) {
      score += 10;
    }
    
    // Технология (высокий приоритет)
    if (pattern.technology.toLowerCase().includes(query)) {
      score += 8;
    }
    
    // Описание (средний приоритет)
    if (pattern.description.toLowerCase().includes(query)) {
      score += 5;
    }
    
    // Теги (средний приоритет)
    for (const tag of pattern.tags) {
      if (tag.toLowerCase().includes(query)) {
        score += 3;
      }
    }
    
    // Бонус за качество паттерна
    score += pattern.confidence * 2;
    score += (100 - pattern.riskScore) / 50; // Меньше риск = больше очков
    
    return score;
  }
}
