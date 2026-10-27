import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[ContextInjector]');
/**
 * M7 v3.0 - Context Injector
 * 
 * Автоматическое обогащение контекста для AI запросов
 */

import { PersistentMemory, SearchResult } from './unified-memory-core.js';
import { 
  ContextInjectionConfig, 
  EnrichedContext, 
  RelevantChunk,
  DEFAULT_CONTEXT_INJECTION_CONFIG 
} from './types.js';
import { ProjectInfo } from './types.js';

/**
 * Кэш результатов поиска
 */
interface SearchCache {
  query: string;
  projectId: string;
  results: RelevantChunk[];
  timestamp: number;
}

/**
 * Context Injector - автоматическое обогащение контекста
 */
export class ContextInjector {
  private config: ContextInjectionConfig;
  private cache: Map<string, SearchCache> = new Map();
  private stats = {
    totalInjections: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalSearchTime: 0,
  };

  constructor(config?: Partial<ContextInjectionConfig>) {
    this.config = {
      ...DEFAULT_CONTEXT_INJECTION_CONFIG,
      ...config,
    };
  }

  /**
   * Обогатить контекст для запроса
   */
  async inject(
    query: string,
    memory: PersistentMemory,
    projectInfo: ProjectInfo
  ): Promise<EnrichedContext> {
    if (!this.config.enabled) {
      return this.createEmptyContext(query, projectInfo);
    }

    const startTime = Date.now();
    this.stats.totalInjections++;

    // Проверить кэш
    const cacheKey = this.getCacheKey(query, projectInfo.id);
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      this.stats.cacheHits++;
      return this.buildContext(query, cached, projectInfo, Date.now() - startTime, 'cache');
    }

    this.stats.cacheMisses++;

    try {
      // Семантический поиск
      const searchResults = await memory.search({
        query: query,
        limit: this.config.topK * 2, // Запрашиваем больше для фильтрации
        threshold: this.config.minScore,
      });

      // Фильтруем по exclude patterns
      const filtered = this.filterResults(searchResults);

      // Преобразуем в RelevantChunk
      const chunks = this.toRelevantChunks(filtered);

      // Сохраняем в кэш
      this.setToCache(cacheKey, projectInfo.id, chunks);

      const searchTime = Date.now() - startTime;
      this.stats.totalSearchTime += searchTime;

      return this.buildContext(query, chunks, projectInfo, searchTime, 'search');
    } catch (error: any) {
      log.debug('ContextInjector] Search failed:', error.message);
      return this.createEmptyContext(query, projectInfo);
    }
  }

  /**
   * Проверить, нужен ли injection для данного trigger
   */
  shouldInject(trigger: 'analyzeTask' | 'hiveCoordinator' | 'session'): boolean {
    return this.config.enabled && this.config.triggers[trigger];
  }

  /**
   * Получить статистику
   */
  getStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalInjections > 0
        ? this.stats.cacheHits / this.stats.totalInjections
        : 0,
      avgSearchTime: this.stats.cacheMisses > 0
        ? this.stats.totalSearchTime / this.stats.cacheMisses
        : 0,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Обновить конфигурацию
   */
  updateConfig(config: Partial<ContextInjectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Построить EnrichedContext
   */
  private buildContext(
    query: string,
    chunks: RelevantChunk[],
    projectInfo: ProjectInfo,
    searchDuration: number,
    source: 'cache' | 'search'
  ): EnrichedContext {
    // Ограничить количество чанков
    const limitedChunks = chunks.slice(0, this.config.topK);

    // Собрать контекст с учётом лимита токенов
    const assembledContext = this.assembleContext(limitedChunks, projectInfo);
    const tokenCount = this.estimateTokens(assembledContext);

    return {
      originalQuery: query,
      relevantChunks: limitedChunks,
      projectInfo: {
        id: projectInfo.id,
        name: projectInfo.displayName,
        technologies: projectInfo.technologies,
        patterns: this.extractPatterns(limitedChunks),
      },
      assembledContext,
      tokenCount,
      searchDuration,
      source,
    };
  }

  /**
   * Собрать контекст для AI
   */
  private assembleContext(chunks: RelevantChunk[], projectInfo: ProjectInfo): string {
    if (chunks.length === 0) {
      return '';
    }

    const parts: string[] = [];
    let currentTokens = 0;
    const maxTokens = this.config.maxTokens;

    // Заголовок
    const header = `## Project Context: ${projectInfo.displayName}
Technologies: ${projectInfo.technologies.join(', ') || 'Not detected'}

### Relevant Code:`;
    
    parts.push(header);
    currentTokens += this.estimateTokens(header);

    // Добавляем чанки с учётом лимита
    for (const chunk of chunks) {
      const chunkText = `
**${chunk.source}** (relevance: ${(chunk.score * 100).toFixed(0)}%)
\`\`\`${chunk.language || ''}
${chunk.content}
\`\`\``;

      const chunkTokens = this.estimateTokens(chunkText);
      
      if (currentTokens + chunkTokens > maxTokens) {
        // Добавить укороченную версию
        const remaining = maxTokens - currentTokens - 50;
        if (remaining > 100) {
          const shortened = chunk.content.slice(0, remaining * 4); // ~4 chars per token
          parts.push(`
**${chunk.source}** (relevance: ${(chunk.score * 100).toFixed(0)}%)
\`\`\`${chunk.language || ''}
${shortened}...
\`\`\``);
        }
        break;
      }

      parts.push(chunkText);
      currentTokens += chunkTokens;
    }

    return parts.join('\n');
  }

  /**
   * Создать пустой контекст
   */
  private createEmptyContext(query: string, projectInfo: ProjectInfo): EnrichedContext {
    return {
      originalQuery: query,
      relevantChunks: [],
      projectInfo: {
        id: projectInfo.id,
        name: projectInfo.displayName,
        technologies: projectInfo.technologies,
        patterns: [],
      },
      assembledContext: '',
      tokenCount: 0,
      searchDuration: 0,
      source: 'search',
    };
  }

  /**
   * Преобразовать SearchResult в RelevantChunk
   */
  private toRelevantChunks(results: SearchResult[]): RelevantChunk[] {
    return results.map(r => ({
      content: r.entry.content,
      source: r.entry.metadata.source,
      score: r.score,
      type: r.entry.metadata.type,
      language: r.entry.metadata.language,
      lines: r.entry.metadata.lineStart && r.entry.metadata.lineEnd
        ? { start: r.entry.metadata.lineStart, end: r.entry.metadata.lineEnd }
        : undefined,
    }));
  }

  /**
   * Фильтровать результаты по exclude patterns
   */
  private filterResults(results: SearchResult[]): SearchResult[] {
    return results.filter(r => {
      const source = r.entry.metadata.source;
      return !this.config.excludePatterns.some(pattern => {
        const regex = this.patternToRegex(pattern);
        return regex.test(source);
      });
    });
  }

  /**
   * Преобразовать glob pattern в regex
   */
  private patternToRegex(pattern: string): RegExp {
    const regexStr = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp(regexStr);
  }

  /**
   * Извлечь паттерны из чанков
   */
  private extractPatterns(chunks: RelevantChunk[]): string[] {
    const patterns: Set<string> = new Set();

    for (const chunk of chunks) {
      // Извлекаем паттерны из контента
      const content = chunk.content.toLowerCase();

      // Паттерны импортов
      if (content.includes('import')) {
        const imports = content.match(/from ['"]([^'"]+)['"]/g);
        if (imports) {
          for (const imp of imports) {
            const lib = imp.match(/from ['"]([^'"]+)['"]/)?.[1];
            if (lib && !lib.startsWith('.')) {
              patterns.add(`uses: ${lib.split('/')[0]}`);
            }
          }
        }
      }

      // Паттерны классов/функций
      if (content.includes('class ')) patterns.add('uses: classes');
      if (content.includes('async ')) patterns.add('uses: async/await');
      if (content.includes('usestate') || content.includes('useeffect')) {
        patterns.add('uses: React Hooks');
      }
    }

    return Array.from(patterns).slice(0, 10);
  }

  /**
   * Оценить количество токенов
   */
  private estimateTokens(text: string): number {
    // Грубая оценка: ~4 символа на токен для английского/кода
    return Math.ceil(text.length / 4);
  }

  /**
   * Получить ключ кэша
   */
  private getCacheKey(query: string, projectId: string): string {
    // Нормализуем запрос
    const normalized = query.toLowerCase().trim().slice(0, 200);
    return `${projectId}:${normalized}`;
  }

  /**
   * Получить из кэша
   */
  private getFromCache(key: string): RelevantChunk[] | null {
    if (!this.config.cacheResults) return null;

    const cached = this.cache.get(key);
    if (!cached) return null;

    // Проверить TTL
    if (Date.now() - cached.timestamp > this.config.resultsCacheTtl) {
      this.cache.delete(key);
      return null;
    }

    return cached.results;
  }

  /**
   * Сохранить в кэш
   */
  private setToCache(key: string, projectId: string, results: RelevantChunk[]): void {
    if (!this.config.cacheResults) return;

    // Ограничить размер кэша
    if (this.cache.size >= 100) {
      // Удалить самые старые
      const oldest = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 20);
      
      for (const [k] of oldest) {
        this.cache.delete(k);
      }
    }

    this.cache.set(key, {
      query: key,
      projectId,
      results,
      timestamp: Date.now(),
    });
  }
}

