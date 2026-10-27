import { createLogger } from '../utils/logger.js';
const log = createLogger('[scopeScanner]');
/**
 * M7 v3.9 - Smart Scope Scanner with Tiered Caching
 * 
 * Сканирует кодовую базу для корректировки оценки scope задачи.
 * v3.5.1: LLM сам выбирает паттерны через Intent Classifier — убран hardcoded KEYWORD_TO_PATTERNS.
 * v3.9.0: Tiered scanning + cache для оптимизации производительности.
 * 
 * @author M7 AI Assistant
 * @version 3.9.0
 * @date 2026-01-26
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  ScopeContext, 
  TaskKeywords, 
  PatternMatch, 
  FileStats, 
  LineStats,
  ScopeRecommendation,
  ScanOptions,
  DEFAULT_SCAN_OPTIONS
} from './types.js';
import { 
  TECHNOLOGY_PATTERNS, 
  getPatternsForKeywords,
  getPatternById
} from './patterns.js';
import type { ScanPattern } from './patterns.js';
import { TaskRoute } from '../types.js';
import { ScanPatternId } from '../intelligence/intentClassifier.js';
import { getScopeCache, ScopeCache } from './scopeCache.js';

// ============================================
// SCOPE SCANNER CLASS
// ============================================

export class ScopeScanner {
  private options: Required<ScanOptions>;
  private cache: ScopeCache;
  
  // v3.9: Cache TTL settings
  private readonly CACHE_TTL_MS = 60000; // 1 minute
  
  constructor(options?: ScanOptions) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
    this.cache = getScopeCache();
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  
  /**
   * Сканировать проект и получить контекст scope
   * v3.5.1: Принимает LLM-selected паттерны напрямую или использует keyword extraction как fallback
   * v3.9.0: Tiered scanning - cache → quick scan → full scan
   */
  async scan(
    projectPath: string, 
    taskDescription: string,
    llmPatterns?: ScanPatternId[],
    llmExtensions?: string[]
  ): Promise<ScopeContext> {
    const startTime = Date.now();
    
    // ============================================
    // TIER 1: Cache lookup (O(1))
    // ============================================
    const cached = this.cache.get(projectPath, llmPatterns, llmExtensions, this.CACHE_TTL_MS);
    if (cached) {
      const cacheStats = this.cache.getStats();
      log.debug(`ScopeScanner v3.9] ✓ Cache hit (${cacheStats.hitRate}% hit rate)`);
      return {
        ...cached,
        scanDurationMs: Date.now() - startTime,
        scannedAt: new Date().toISOString()
      };
    }
    
    let patterns: ScanPattern[];
    let fileTypes: string[];
    
    // v3.5.1: Приоритет LLM-selected паттернам
    if (llmPatterns && llmPatterns.length > 0) {
      // LLM уже выбрал — используем напрямую
      patterns = llmPatterns.map(id => getPatternById(id)).filter(Boolean) as ScanPattern[];
      fileTypes = llmExtensions || [];
      log.debug(`ScopeScanner v3.9] LLM patterns: ${patterns.map(p => p.id).join(', ')}`);
    } else {
      // Fallback: keyword extraction (legacy режим)
      const keywords = this.extractKeywords(taskDescription);
      log.debug(`ScopeScanner v3.9] Fallback mode - tech=${keywords.technologies.join(',')}`);
      
      const allKeywords = [...keywords.technologies, ...keywords.actions];
      patterns = getPatternsForKeywords(allKeywords);
      fileTypes = keywords.fileTypes;
    }
    
    // ============================================
    // TIER 2: Quick scan for simple tasks (no patterns)
    // ============================================
    if (patterns.length === 0 && fileTypes.length === 0) {
      log.debug(`ScopeScanner v3.9] ✓ Quick scan (no patterns/extensions specified)`);
      const emptyResult = this.createEmptyResult(projectPath, startTime);
      this.cache.set(projectPath, llmPatterns, llmExtensions, emptyResult);
      return emptyResult;
    }
    
    // ============================================
    // TIER 3: Full scan (targeted directories if possible)
    // ============================================
    log.debug(`ScopeScanner v3.9] Full scan: ${patterns.length} patterns, ${fileTypes.length} extensions`);
    
    // Phase 1: Быстрый подсчёт файлов
    const fileStats = await this.countFiles(projectPath, fileTypes);
    log.debug(`ScopeScanner v3.9] Files: total=${fileStats.total}, matching=${fileStats.matchingPattern}`);
    
    // Phase 2: Детальное сканирование выборки (если есть матчащие файлы и паттерны)
    let patternMatches: PatternMatch[] = [];
    let lineStats: LineStats = { total: 0, code: 0, inMatchingFiles: 0 };
    
    if (fileStats.matchingPattern > 0 && patterns.length > 0) {
      const sampleResult = await this.sampleScan(projectPath, fileTypes, patterns);
      patternMatches = sampleResult.patterns;
      lineStats = sampleResult.lineStats;
      
      // Экстраполяция если просканировали только выборку
      if (sampleResult.sampledFiles < fileStats.matchingPattern) {
        const ratio = fileStats.matchingPattern / sampleResult.sampledFiles;
        patternMatches = patternMatches.map(p => ({
          ...p,
          count: Math.round(p.count * ratio),
          files: Math.min(Math.round(p.files * ratio), fileStats.matchingPattern)
        }));
        lineStats.inMatchingFiles = Math.round(lineStats.inMatchingFiles * ratio);
      }
    }
    
    // Сформировать рекомендацию
    const recommendation = this.generateRecommendation(fileStats, patternMatches);
    
    // Сформировать контекст для LLM
    const promptContext = this.formatPromptContext(fileStats, patternMatches, recommendation);
    
    const scanDurationMs = Date.now() - startTime;
    log.debug(`ScopeScanner v3.9] ✓ Completed in ${scanDurationMs}ms, route: ${recommendation.suggestedRoute}`);
    
    const result: ScopeContext = {
      scannedAt: new Date().toISOString(),
      scanDurationMs,
      projectPath,
      fileStats,
      lineStats,
      patterns: patternMatches,
      recommendation,
      promptContext
    };
    
    // Cache the result
    this.cache.set(projectPath, llmPatterns, llmExtensions, result);
    
    return result;
  }
  
  /**
   * v3.9: Создать пустой результат для quick scan
   */
  private createEmptyResult(projectPath: string, startTime: number): ScopeContext {
    return {
      scannedAt: new Date().toISOString(),
      scanDurationMs: Date.now() - startTime,
      projectPath,
      fileStats: { total: 0, byExtension: {}, matchingPattern: 0 },
      lineStats: { total: 0, code: 0, inMatchingFiles: 0 },
      patterns: [],
      recommendation: {
        suggestedRoute: 'medium',
        suggestedFiles: 0,
        suggestedMinutes: 15,
        reasoning: 'No specific patterns detected - using default route.'
      },
      promptContext: ''
    };
  }
  
  /**
   * v3.9: Получить статистику кеша
   */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    return this.cache.getStats();
  }
  
  /**
   * v3.9: Инвалидировать кеш для проекта
   */
  invalidateCache(projectPath?: string): void {
    if (projectPath) {
      this.cache.invalidate(projectPath);
    } else {
      this.cache.clear();
    }
  }
  
  // ============================================
  // KEYWORD EXTRACTION
  // ============================================
  
  /**
   * Извлечь ключевые слова из описания задачи
   */
  extractKeywords(task: string): TaskKeywords {
    const taskLower = task.toLowerCase();
    
    // Технологии (включая паттерны кода)
    const techKeywords = [
      'php', 'php5', 'php7', 'php8',
      'javascript', 'js', 'typescript', 'ts',
      'react', 'vue', 'angular', 'svelte',
      'node', 'nodejs', 'deno', 'bun',
      'python', 'python2', 'python3', 'py',
      'ruby', 'rails',
      'java', 'kotlin', 'scala',
      'go', 'golang', 'rust',
      'esm', 'commonjs', 'cjs',
      'hooks', 'class component',
      'css', 'scss', 'sass', 'less',
      // Паттерны кода
      'console.log', 'console', 'logging',
      'var ', 'require(', 'module.exports'
    ];
    const technologies = techKeywords.filter(t => taskLower.includes(t));
    
    // Действия (включая русские)
    const actionKeywords = [
      'refactor', 'refactoring',
      'migrate', 'migration',
      'upgrade', 'update',
      'convert', 'transform',
      'cleanup', 'clean up', 'clean',
      'fix', 'fixing',
      'modernize', 'modernization',
      'optimize', 'optimization',
      'rewrite',
      'remove', 'delete',
      // Русские эквиваленты
      'рефакторин', 'рефактор', 'переделать', 'переписать',
      'мигрир', 'обновить', 'апгрейд',
      'почин', 'исправ', 'фикс',
      'оптимиз', 'удалить', 'убрать',
      'заменить', 'замен'
    ];
    const actions = actionKeywords.filter(a => taskLower.includes(a));
    
    // Определить расширения файлов на основе технологий
    const fileTypes = new Set<string>();
    
    if (technologies.some(t => ['php', 'php5', 'php7', 'php8'].includes(t))) {
      fileTypes.add('.php');
    }
    if (technologies.some(t => ['typescript', 'ts'].includes(t))) {
      fileTypes.add('.ts');
      fileTypes.add('.tsx');
    }
    if (technologies.some(t => ['javascript', 'js', 'esm', 'commonjs', 'cjs', 'node', 'nodejs'].includes(t))) {
      fileTypes.add('.js');
      fileTypes.add('.jsx');
    }
    if (technologies.some(t => t === 'react')) {
      fileTypes.add('.jsx');
      fileTypes.add('.tsx');
      fileTypes.add('.js');
      fileTypes.add('.ts');
    }
    if (technologies.some(t => ['python', 'python2', 'python3', 'py'].includes(t))) {
      fileTypes.add('.py');
    }
    if (technologies.some(t => ['css', 'scss', 'sass', 'less'].includes(t))) {
      fileTypes.add('.css');
      fileTypes.add('.scss');
      fileTypes.add('.less');
    }
    if (technologies.some(t => ['go', 'golang'].includes(t))) {
      fileTypes.add('.go');
    }
    if (technologies.some(t => t === 'rust')) {
      fileTypes.add('.rs');
    }
    if (technologies.some(t => ['java', 'kotlin'].includes(t))) {
      fileTypes.add('.java');
      if (technologies.includes('kotlin')) fileTypes.add('.kt');
    }
    
    return {
      fileTypes: Array.from(fileTypes),
      technologies,
      actions
    };
  }
  
  // ============================================
  // FILE COUNTING
  // ============================================
  
  /**
   * Быстрый подсчёт файлов в проекте
   */
  private async countFiles(rootPath: string, targetExtensions: string[]): Promise<FileStats> {
    const byExtension: Record<string, number> = {};
    let total = 0;
    let matchingPattern = 0;
    
    const walk = (dir: string) => {
      if (total >= this.options.maxFiles) return;
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (total >= this.options.maxFiles) break;
          
          const fullPath = path.join(dir, entry.name);
          
          // Пропустить исключённые директории
          if (this.shouldExclude(entry.name)) continue;
          
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            total++;
            const ext = path.extname(entry.name).toLowerCase();
            
            if (ext) {
              byExtension[ext] = (byExtension[ext] || 0) + 1;
            }
            
            // Проверить совпадение с целевыми расширениями
            if (targetExtensions.length === 0 || targetExtensions.includes(ext)) {
              matchingPattern++;
            }
          }
        }
      } catch (e) {
        // Пропускаем недоступные директории
      }
    };
    
    walk(rootPath);
    
    return { total, byExtension, matchingPattern };
  }
  
  // ============================================
  // DETAILED SCANNING
  // ============================================
  
  /**
   * Детальное сканирование выборки файлов
   */
  private async sampleScan(
    rootPath: string,
    extensions: string[],
    patterns: ScanPattern[]
  ): Promise<{ patterns: PatternMatch[]; lineStats: LineStats; sampledFiles: number }> {
    
    // Собрать файлы для выборки
    const files = this.collectSampleFiles(rootPath, extensions);
    
    // Агрегация результатов по паттернам
    const patternCounts: Map<string, { 
      count: number; 
      files: Set<string>; 
      examples: string[];
      patternName: string;
    }> = new Map();
    
    let totalLines = 0;
    let codeLines = 0;
    
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.size > this.options.maxFileSize) continue;
        
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        totalLines += lines.length;
        
        // Простой подсчёт строк кода (без пустых)
        codeLines += lines.filter(l => l.trim().length > 0).length;
        
        // Поиск паттернов
        for (const pattern of patterns) {
          for (const regex of pattern.codePatterns) {
            // Сбросить lastIndex для глобальных regex
            regex.lastIndex = 0;
            const matches = content.match(regex);
            
            if (matches && matches.length > 0) {
              const key = `${pattern.id}:${regex.source.slice(0, 30)}`;
              
              if (!patternCounts.has(key)) {
                patternCounts.set(key, { 
                  count: 0, 
                  files: new Set(), 
                  examples: [],
                  patternName: pattern.name
                });
              }
              
              const entry = patternCounts.get(key)!;
              entry.count += matches.length;
              entry.files.add(file);
              
              // Сохранить примеры (первые 3)
              if (entry.examples.length < 3) {
                for (const match of matches.slice(0, 3 - entry.examples.length)) {
                  // Очистить и укоротить пример
                  const example = match.trim().slice(0, 50);
                  if (!entry.examples.includes(example)) {
                    entry.examples.push(example);
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // Пропускаем файлы, которые не можем прочитать
      }
    }
    
    // Конвертировать результаты
    const patternMatches: PatternMatch[] = Array.from(patternCounts.entries())
      .map(([key, data]) => ({
        pattern: data.patternName,
        count: data.count,
        files: data.files.size,
        examples: data.examples
      }))
      // Агрегировать по имени паттерна
      .reduce((acc, curr) => {
        const existing = acc.find(p => p.pattern === curr.pattern);
        if (existing) {
          existing.count += curr.count;
          existing.files = Math.max(existing.files, curr.files);
          existing.examples = [...new Set([...existing.examples, ...curr.examples])].slice(0, 3);
        } else {
          acc.push(curr);
        }
        return acc;
      }, [] as PatternMatch[])
      // Сортировать по количеству
      .sort((a, b) => b.count - a.count);
    
    return {
      patterns: patternMatches,
      lineStats: {
        total: totalLines,
        code: codeLines,
        inMatchingFiles: totalLines
      },
      sampledFiles: files.length
    };
  }
  
  /**
   * Собрать файлы для выборки
   */
  private collectSampleFiles(rootPath: string, extensions: string[]): string[] {
    const files: string[] = [];
    
    const walk = (dir: string) => {
      if (files.length >= this.options.maxSampleFiles) return;
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (files.length >= this.options.maxSampleFiles) break;
          
          const fullPath = path.join(dir, entry.name);
          
          if (this.shouldExclude(entry.name)) continue;
          
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            
            if (extensions.length === 0 || extensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (e) {
        // Пропускаем недоступные директории
      }
    };
    
    walk(rootPath);
    return files;
  }
  
  // ============================================
  // RECOMMENDATION GENERATION
  // ============================================
  
  /**
   * Генерация рекомендации по route
   */
  private generateRecommendation(
    fileStats: FileStats,
    patterns: PatternMatch[]
  ): ScopeRecommendation {
    
    const matchingFiles = fileStats.matchingPattern;
    const totalPatternMatches = patterns.reduce((sum, p) => sum + p.count, 0);
    const affectedFiles = patterns.length > 0 
      ? Math.max(...patterns.map(p => p.files))
      : matchingFiles;
    
    let suggestedRoute: TaskRoute;
    let reasoning: string;
    
    // Логика определения route
    if (matchingFiles > 50 || totalPatternMatches > 500) {
      suggestedRoute = 'decompose';
      reasoning = `Слишком большой scope: ${matchingFiles} файлов, ${totalPatternMatches} паттернов. Рекомендуется разбить на подзадачи.`;
    } else if (matchingFiles > 15 || totalPatternMatches > 100) {
      suggestedRoute = 'heavy';
      reasoning = `Значительный scope: ${matchingFiles} файлов, ${totalPatternMatches} изменений требуется.`;
    } else if (matchingFiles > 5 || totalPatternMatches > 20) {
      suggestedRoute = 'medium';
      reasoning = `Умеренный scope: ${matchingFiles} файлов, ${totalPatternMatches} изменений.`;
    } else if (matchingFiles > 0) {
      suggestedRoute = 'light';
      reasoning = `Небольшой scope: ${matchingFiles} файлов, ${totalPatternMatches} изменений.`;
    } else {
      suggestedRoute = 'medium';
      reasoning = 'Не удалось определить релевантные файлы. Используется стандартный route.';
    }
    
    // Оценка времени
    // Base: 5 мин на файл + 1 мин на 10 паттернов
    // Min: 15 мин, Max: 480 мин (8 часов)
    const baseMinutes = matchingFiles * 5 + Math.ceil(totalPatternMatches / 10);
    const suggestedMinutes = Math.min(480, Math.max(15, baseMinutes));
    
    return {
      suggestedRoute,
      suggestedFiles: affectedFiles > 0 ? affectedFiles : matchingFiles,
      suggestedMinutes,
      reasoning
    };
  }
  
  // ============================================
  // LLM CONTEXT FORMATTING
  // ============================================
  
  /**
   * Форматирование контекста для LLM промпта
   */
  private formatPromptContext(
    fileStats: FileStats,
    patterns: PatternMatch[],
    recommendation: ScopeRecommendation
  ): string {
    
    if (fileStats.matchingPattern === 0 && patterns.length === 0) {
      return '';
    }
    
    let context = `
## 📊 SCOPE SCAN RESULTS (ВАЖНО для оценки!)

| Метрика | Значение |
|---------|----------|
| **Всего файлов в проекте** | ${fileStats.total} |
| **Релевантных файлов** | ${fileStats.matchingPattern} |
| **Рекомендация сканера** | route: **${recommendation.suggestedRoute}**, ~${recommendation.suggestedFiles} файлов |

`;

    // Топ расширения
    const topExtensions = Object.entries(fileStats.byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topExtensions.length > 0) {
      context += `### Файлы по типам:\n`;
      for (const [ext, count] of topExtensions) {
        context += `- \`${ext}\`: ${count} файлов\n`;
      }
      context += '\n';
    }

    // Паттерны
    if (patterns.length > 0) {
      context += `### Обнаруженные паттерны:\n`;
      for (const p of patterns.slice(0, 5)) {
        context += `- **${p.pattern}**: ${p.count} совпадений в ${p.files} файлах\n`;
        if (p.examples.length > 0) {
          context += `  - Примеры: \`${p.examples.slice(0, 2).join('`, `')}\`\n`;
        }
      }
      context += '\n';
    }

    context += `### ⚠️ Обоснование:
${recommendation.reasoning}

**Учитывай эти данные при определении route и estimatedFiles!**
`;
    
    return context;
  }
  
  // ============================================
  // UTILITIES
  // ============================================
  
  /**
   * Проверка, нужно ли исключить директорию/файл
   */
  private shouldExclude(name: string): boolean {
    // Скрытые файлы
    if (!this.options.includeHidden && name.startsWith('.')) {
      return true;
    }
    
    // Исключённые директории
    return this.options.excludeDirs.includes(name);
  }
}

// ============================================
// SINGLETON & EXPORTS
// ============================================

let scannerInstance: ScopeScanner | null = null;

/**
 * Получить singleton сканера
 */
export function getScopeScanner(options?: ScanOptions): ScopeScanner {
  if (!scannerInstance || options) {
    scannerInstance = new ScopeScanner(options);
  }
  return scannerInstance;
}

/**
 * Сканировать scope проекта
 * v3.5.1: Поддержка LLM-selected паттернов
 */
export async function scanProjectScope(
  projectPath: string, 
  taskDescription: string,
  options?: ScanOptions,
  llmPatterns?: ScanPatternId[],
  llmExtensions?: string[]
): Promise<ScopeContext> {
  const scanner = getScopeScanner(options);
  return scanner.scan(projectPath, taskDescription, llmPatterns, llmExtensions);
}
